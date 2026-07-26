-- Flux de paiement Stripe Checkout (MODE TEST) — encaissement de la structure
-- au moment de l'affectation d'un candidat.
--
-- Principe : sur une mission rémunérée, accepter un candidat = payer. La
-- candidature reste 'pending' tant que Stripe n'a pas confirmé le paiement ;
-- seul le webhook (service_role) la fait passer à 'accepted'. Le crédit Wallet
-- du travailleur n'est jamais créé à l'acceptation : il reste créé en fin de
-- mission, et uniquement si le paiement Stripe de la structure est bien 'paid'.
--
-- L'encaissement Stripe est enregistré sur la candidature (colonnes
-- stripe_* déjà présentes) et non dans public.payments, qui reste le registre
-- interne de fin de mission (process_mission_payment) — aucune collision avec
-- la contrainte unique payments(application_id).

alter table public.applications
  add column if not exists stripe_checkout_session_id text;

create index if not exists applications_stripe_checkout_session_idx
  on public.applications (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- Mémorise la Checkout Session créée (statut candidature inchangé : pending).
create or replace function public.attach_mission_checkout_session(
  p_application_id uuid, p_session_id text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Réservé au backend UROSI.';
  end if;
  update public.applications
  set stripe_checkout_session_id = p_session_id
  where id = p_application_id;
end;
$$;

-- Confirmation du paiement (webhook uniquement). Idempotente : un rejeu
-- (webhook répété) n'a aucun effet si le paiement est déjà 'paid'. Passe la
-- candidature 'pending' -> 'accepted' (acceptation = paiement), enregistre les
-- identifiants Stripe et notifie la structure. La notification d'acceptation
-- côté travailleur est déjà émise par le trigger de statut existant
-- (trg_notify_application_status), qui ouvre aussi le fil de discussion.
create or replace function public.confirm_mission_checkout_payment(
  p_application_id uuid,
  p_session_id text,
  p_payment_intent_id text default null,
  p_amount_total integer default null,
  p_charge_id text default null
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_app record;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Confirmation réservée au backend UROSI.';
  end if;

  select a.id, a.status, a.worker_id, a.stripe_payment_status,
         m.title, m.structure_id, s.owner_id
  into v_app
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = p_application_id
  for update of a;

  if not found then
    return false;
  end if;
  if coalesce(v_app.stripe_payment_status, '') = 'paid' then
    return false; -- déjà confirmé (rejeu webhook) : aucun double traitement.
  end if;

  update public.applications
  set stripe_checkout_session_id = coalesce(p_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
      stripe_charge_id = coalesce(p_charge_id, stripe_charge_id),
      stripe_payment_status = 'paid',
      status = case when status = 'pending' then 'accepted' else status end
  where id = p_application_id;

  perform public.notify(
    v_app.owner_id, 'payment', 'Paiement confirmé ✅',
    'Le paiement de la mission « ' || v_app.title || ' » est confirmé. Le travailleur est affecté.',
    jsonb_build_object('application_id', p_application_id, 'amount_cents', p_amount_total)
  );
  return true;
end;
$$;

-- Paiement non terminé (abandon / expiration / échec asynchrone) : n'affecte
-- jamais une candidature déjà payée/acceptée ; la structure peut relancer.
create or replace function public.mark_mission_checkout_unpaid(
  p_application_id uuid, p_session_id text, p_status text default 'unpaid'
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Réservé au backend UROSI.';
  end if;
  update public.applications
  set stripe_payment_status = p_status
  where id = p_application_id
    and coalesce(stripe_payment_status, '') <> 'paid'
    and status = 'pending';
end;
$$;

-- Durcissement : une candidature ne peut pas être acceptée côté client sur une
-- mission rémunérée sans paiement Stripe confirmé. Le backend (webhook,
-- service_role) reste seul à pouvoir la faire passer à 'accepted', après
-- paiement. La règle est ainsi garantie en base, pas seulement dans l'UI.
create or replace function public.guard_application_state_and_capacity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_backend boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_mission record;
  v_capacity integer;
  v_committed integer;
begin
  if tg_op = 'INSERT' then
    if not v_backend and new.status <> 'pending' then
      raise exception using errcode = '23514', message = 'Une candidature commence au statut en attente.';
    end if;
  elsif new.status is distinct from old.status and not v_backend then
    if not (
      (old.status = 'pending' and new.status in ('accepted', 'rejected', 'cancelled'))
      or (old.status = 'accepted' and new.status in ('in_progress', 'cancelled', 'disputed'))
      or (old.status = 'in_progress' and new.status in ('payment_pending', 'cancelled', 'disputed'))
      or (old.status = 'payment_pending' and new.status = 'disputed')
    ) then
      raise exception using errcode = '23514', message = 'Transition de candidature interdite.';
    end if;

    if new.status = 'in_progress'
       and (new.actual_start_at is null or new.attendance_status <> 'start_confirmed') then
      raise exception using errcode = '23514', message = 'Le debut doit etre confirme par le pointage securise.';
    end if;
    if new.status = 'payment_pending'
       and (new.actual_end_at is null or new.payment_ready_at is null
            or new.attendance_status <> 'end_confirmed') then
      raise exception using errcode = '23514', message = 'La fin doit etre confirmee avant paiement.';
    end if;
  end if;

  if new.status = 'accepted'
     and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    select m.status, m.positions, m.places, m.worker_rate_cents, m.is_solidaire
    into v_mission
    from public.missions m
    where m.id = new.mission_id
    for update;

    if not found or v_mission.status <> 'open' then
      raise exception using errcode = '23514', message = 'Cette mission n accepte plus de candidature.';
    end if;

    -- Mission rémunérée : paiement Stripe obligatoire avant confirmation
    -- (sauf backend, qui confirme justement APRÈS paiement via le webhook).
    if not v_backend
       and not coalesce(v_mission.is_solidaire, false)
       and coalesce(v_mission.worker_rate_cents, 0) > 0
       and coalesce(new.stripe_payment_status, '') <> 'paid' then
      raise exception using errcode = '42501',
        message = 'Paiement Stripe requis avant de confirmer cette mission.';
    end if;

    v_capacity := coalesce(nullif(v_mission.positions, 0), nullif(v_mission.places, 0), 1);
    select count(*) into v_committed
    from public.applications a
    where a.mission_id = new.mission_id
      and a.id is distinct from new.id
      and a.status in ('accepted', 'in_progress', 'payment_pending', 'completed', 'disputed');

    if v_committed >= v_capacity then
      raise exception using errcode = '23514', message = 'Toutes les places de cette mission sont deja pourvues.';
    end if;
  end if;
  return new;
end;
$$;

-- Le crédit Wallet en attente (J+3) créé en fin de mission n'est produit que
-- si le paiement Stripe de la structure est confirmé ('paid'). Aucune mission
-- rémunérée non payée ne peut créditer le travailleur.
create or replace function public.trg_create_pending_wallet_earning()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_mission record;
  v_worker_wallet uuid;
begin
  if new.status = 'payment_pending' and old.status is distinct from 'payment_pending' then
    select m.worker_rate_cents, m.is_solidaire, m.title
    into v_mission
    from public.missions m
    where m.id = new.mission_id;

    if not found or v_mission.is_solidaire or v_mission.worker_rate_cents <= 0 then
      return new;
    end if;
    -- Garde-fou paiement réel : pas de crédit sans encaissement Stripe 'paid'.
    if coalesce(new.stripe_payment_status, '') <> 'paid' then
      return new;
    end if;

    v_worker_wallet := public.ensure_wallet(new.worker_id);

    insert into public.wallet_transactions (
      wallet_id, amount_cents, kind, application_id, label, fund_status, available_at
    ) values (
      v_worker_wallet, v_mission.worker_rate_cents, 'mission_earning', new.id,
      'Mission terminée - « ' || v_mission.title || ' »',
      'pending', new.payment_ready_at
    )
    on conflict (wallet_id, application_id, kind)
      where application_id is not null
        and kind in ('mission_earning', 'mission_charge', 'commission')
      do nothing;
  end if;
  return new;
end;
$$;
