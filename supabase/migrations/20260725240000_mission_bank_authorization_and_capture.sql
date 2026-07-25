-- Empreinte bancaire automatique — MODULE 2 etapes 3, 4, 5.
--
-- Autorisation posee UNE FOIS PAR MISSION (montant = tarif x places + 18%),
-- jamais par candidature : accepter un candidat ne verifie plus de paiement
-- individuel, seule l'autorisation globale de la mission compte desormais.
-- PaymentIntent capture_method: manual, off_session: true, sur le
-- payment_method enregistre (etape 2). Capturee (totale ou partielle) a la
-- validation de presence reelle, jamais a l'heure de fin theorique.

-- ---------------------------------------------------------------------------
-- 1. Colonnes d'autorisation/capture sur missions.
-- ---------------------------------------------------------------------------
alter table public.missions add column if not exists payment_authorization_status text not null default 'not_required'
  check (payment_authorization_status in (
    'not_required', 'pending', 'requires_action', 'authorized',
    'failed', 'captured', 'partially_captured', 'canceled'
  ));
alter table public.missions add column if not exists stripe_payment_intent_id text;
alter table public.missions add column if not exists authorization_amount_cents integer;
alter table public.missions add column if not exists authorized_at timestamptz;
alter table public.missions add column if not exists authorization_attempts integer not null default 0;
alter table public.missions add column if not exists authorization_failed_reason text;
alter table public.missions add column if not exists captured_amount_cents integer;
alter table public.missions add column if not exists captured_at timestamptz;

create unique index if not exists missions_stripe_payment_intent_id_key
  on public.missions (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- A la creation d'une mission : 'not_required' si solidaire/0€, sinon
-- 'pending' (en attente d'autorisation — immediate ou a J-2 selon la date).
create or replace function public.missions_set_authorization_requirement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.payment_authorization_status :=
      case when new.is_solidaire or coalesce(new.worker_rate_cents, 0) <= 0 then 'not_required' else 'pending' end;
  end if;
  return new;
end;
$$;

drop trigger if exists missions_set_authorization_requirement on public.missions;
create trigger missions_set_authorization_requirement
  before insert on public.missions
  for each row execute function public.missions_set_authorization_requirement();

-- ---------------------------------------------------------------------------
-- 2. Selection des missions a autoriser (cron J-2 + immediat si <=2 jours).
--    Une seule regle couvre les deux cas du brief : "publiee a plus de 2
--    jours -> autorisation posee a J-2" et "publiee a 2 jours ou moins ->
--    autorisation immediate" reviennent au meme test (starts_at - now() <=
--    2 jours), le cron passant assez souvent (toutes les heures) pour que
--    le cas "immediat" ne prenne jamais plus d'une heure de retard.
-- ---------------------------------------------------------------------------
create or replace function public.missions_due_for_authorization(p_limit integer default 100)
returns table (
  mission_id uuid,
  structure_id uuid,
  owner_id uuid,
  stripe_customer_id text,
  stripe_default_payment_method_id text,
  amount_cents integer,
  attempts integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.structure_id, s.owner_id, s.stripe_customer_id, s.stripe_default_payment_method_id,
         (m.worker_rate_cents * coalesce(nullif(m.positions, 0), nullif(m.places, 0), 1)
           + round(m.worker_rate_cents * coalesce(nullif(m.positions, 0), nullif(m.places, 0), 1)
                   * coalesce((select commission_pct from public.platform_settings where id = true), 18) / 100.0))::integer,
         m.authorization_attempts
  from public.missions m
  join public.structures s on s.id = m.structure_id
  where m.payment_authorization_status = 'pending'
    and m.status = 'open'
    and m.starts_at is not null
    and m.starts_at <= now() + interval '2 days'
    and m.authorization_attempts < 3
  order by m.starts_at
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;

revoke execute on function public.missions_due_for_authorization(integer) from public, anon, authenticated;
grant execute on function public.missions_due_for_authorization(integer) to service_role;

create or replace function public.record_mission_authorization(
  p_mission_id uuid,
  p_stripe_payment_intent_id text,
  p_amount_cents integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission record;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  select m.id, m.title, s.owner_id into v_mission
  from public.missions m join public.structures s on s.id = m.structure_id
  where m.id = p_mission_id
  for update of m;
  if not found then
    return;
  end if;

  update public.missions
  set payment_authorization_status = 'authorized',
      stripe_payment_intent_id = p_stripe_payment_intent_id,
      authorization_amount_cents = p_amount_cents,
      authorized_at = now(),
      authorization_failed_reason = null
  where id = p_mission_id;

  perform public.notify(
    v_mission.owner_id, 'mission_authorized', 'Moyen de paiement provisionné ✅',
    'Le montant de la mission « ' || v_mission.title || ' » (' || to_char(p_amount_cents / 100.0, 'FM999990.00') ||
      ' €) est bloqué sur ta carte. Il ne sera prélevé qu''à la validation de présence.',
    jsonb_build_object('mission_id', p_mission_id, 'amount_cents', p_amount_cents)
  );
end;
$$;

revoke execute on function public.record_mission_authorization(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.record_mission_authorization(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. SCA / requires_action : l'autorisation off-session peut necessiter une
--    authentification par la banque emettrice. Jamais suppose que ca passe
--    toujours — statut explicite + notification avec lien d'authentification.
-- ---------------------------------------------------------------------------
create or replace function public.record_mission_authorization_requires_action(
  p_mission_id uuid,
  p_stripe_payment_intent_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission record;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  select m.id, m.title, s.owner_id into v_mission
  from public.missions m join public.structures s on s.id = m.structure_id
  where m.id = p_mission_id
  for update of m;
  if not found then
    return;
  end if;

  update public.missions
  set payment_authorization_status = 'requires_action',
      stripe_payment_intent_id = p_stripe_payment_intent_id
  where id = p_mission_id;

  perform public.notify(
    v_mission.owner_id, 'mission_authorization_requires_action', 'Action requise pour confirmer ta mission',
    'Ta banque demande une vérification supplémentaire pour provisionner « ' || v_mission.title ||
      ' ». Ouvre l''application pour confirmer, sinon la mission sera retirée avant son début.',
    jsonb_build_object('mission_id', p_mission_id, 'payment_intent_id', p_stripe_payment_intent_id)
  );
end;
$$;

revoke execute on function public.record_mission_authorization_requires_action(uuid, text) from public, anon, authenticated;
grant execute on function public.record_mission_authorization_requires_action(uuid, text) to service_role;

create or replace function public.record_mission_authorization_failure(p_mission_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission record;
  v_attempts integer;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  select m.id, m.title, s.owner_id into v_mission
  from public.missions m join public.structures s on s.id = m.structure_id
  where m.id = p_mission_id
  for update of m;
  if not found then
    return 0;
  end if;

  update public.missions
  set authorization_attempts = authorization_attempts + 1,
      payment_authorization_status = 'failed',
      authorization_failed_reason = p_reason
  where id = p_mission_id
  returning authorization_attempts into v_attempts;

  perform public.notify(
    v_mission.owner_id, 'mission_authorization_failed', 'Provisionnement de la mission échoué',
    'Le paiement de « ' || v_mission.title || ' » a échoué (' || coalesce(p_reason, 'raison inconnue') ||
      '). Régularise avant le début de la mission, sinon elle sera automatiquement retirée.',
    jsonb_build_object('mission_id', p_mission_id, 'reason', p_reason, 'attempts', v_attempts)
  );

  if v_attempts >= 3 then
    perform private.log_founder_action(
      'mission_authorization_max_retries', 'mission', p_mission_id, v_mission.title,
      jsonb_build_object('attempts', v_attempts, 'reason', p_reason)
    );
  end if;

  return v_attempts;
end;
$$;

revoke execute on function public.record_mission_authorization_failure(uuid, text) from public, anon, authenticated;
grant execute on function public.record_mission_authorization_failure(uuid, text) to service_role;

-- Retrait automatique : une mission dont l'autorisation reste en echec (ou
-- en attente d'authentification) au moment de son debut est retiree — les
-- 48h d'avance servent exactement a ca, personne ne se deplace pour une
-- mission non provisionnee. Annule la mission ET les candidatures en cours.
create or replace function public.auto_cancel_unfunded_missions()
returns table(mission_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission record;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  for v_mission in
    select m.id, m.title, s.owner_id
    from public.missions m
    join public.structures s on s.id = m.structure_id
    where m.payment_authorization_status in ('failed', 'requires_action', 'pending')
      and m.status = 'open'
      and m.starts_at is not null
      and m.starts_at <= now()
    limit 200
  loop
    update public.missions set status = 'cancelled' where id = v_mission.id;
    update public.applications
    set status = 'cancelled'
    where mission_id = v_mission.id
      and status in ('pending', 'accepted');

    perform public.notify(
      v_mission.owner_id, 'mission_auto_canceled', 'Mission retirée — paiement non régularisé',
      'La mission « ' || v_mission.title || ' » a été automatiquement retirée : le paiement n''a pas été régularisé avant son début.',
      jsonb_build_object('mission_id', v_mission.id)
    );

    mission_id := v_mission.id;
    outcome := 'canceled_unfunded';
    return next;
  end loop;
  return;
end;
$$;

revoke execute on function public.auto_cancel_unfunded_missions() from public, anon, authenticated;
grant execute on function public.auto_cancel_unfunded_missions() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Capture a la validation de presence (totale, partielle, annulation).
--    Une mission est prete a cloturer son autorisation des que plus aucune
--    candidature n'est encore "en cours" (accepted/in_progress) : chaque
--    travailleur est soit alle au bout (payment_pending/completed), soit
--    absent/annule (cancelled/rejected/disputed). Le montant realise
--    recalcule proportionnellement les heures reellement effectuees quand
--    la mission a ete ecourtee (fin anticipee par rapport au planning).
-- ---------------------------------------------------------------------------
create or replace function public.compute_mission_capture_amount(p_mission_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    round(
      m.worker_rate_cents
      * least(
          1.0,
          case
            when a.actual_start_at is not null and a.actual_end_at is not null
                 and m.starts_at is not null and m.ends_at is not null
                 and m.ends_at > m.starts_at
            then greatest(0.0, extract(epoch from (a.actual_end_at - a.actual_start_at))
                   / extract(epoch from (m.ends_at - m.starts_at)))
            else 1.0
          end
        )
    )
  ), 0)::integer
  from public.applications a
  join public.missions m on m.id = a.mission_id
  where a.mission_id = p_mission_id
    and a.status in ('payment_pending', 'completed')
$$;

revoke execute on function public.compute_mission_capture_amount(uuid) from public, anon;
grant execute on function public.compute_mission_capture_amount(uuid) to authenticated, service_role;

create or replace function public.missions_ready_for_capture(p_limit integer default 100)
returns table (
  mission_id uuid,
  stripe_payment_intent_id text,
  authorized_amount_cents integer,
  realized_worker_cents integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.stripe_payment_intent_id, m.authorization_amount_cents,
         public.compute_mission_capture_amount(m.id)
  from public.missions m
  where m.payment_authorization_status = 'authorized'
    and m.stripe_payment_intent_id is not null
    and not exists (
      select 1 from public.applications a
      where a.mission_id = m.id and a.status in ('accepted', 'in_progress')
    )
    and exists (
      select 1 from public.applications a
      where a.mission_id = m.id and a.status in ('pending', 'payment_pending', 'completed')
    )
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;

revoke execute on function public.missions_ready_for_capture(integer) from public, anon, authenticated;
grant execute on function public.missions_ready_for_capture(integer) to service_role;

create or replace function public.record_mission_capture(
  p_mission_id uuid,
  p_captured_amount_cents integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission record;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  select m.id, m.title, m.authorization_amount_cents, s.owner_id into v_mission
  from public.missions m join public.structures s on s.id = m.structure_id
  where m.id = p_mission_id
  for update of m;
  if not found then
    return;
  end if;

  update public.missions
  set payment_authorization_status =
        case when p_captured_amount_cents >= coalesce(v_mission.authorization_amount_cents, p_captured_amount_cents)
             then 'captured' else 'partially_captured' end,
      captured_amount_cents = p_captured_amount_cents,
      captured_at = now()
  where id = p_mission_id;

  perform public.notify(
    v_mission.owner_id, 'mission_captured', 'Paiement prélevé',
    to_char(p_captured_amount_cents / 100.0, 'FM999990.00') || ' € prélevés pour « ' || v_mission.title || ' ».',
    jsonb_build_object('mission_id', p_mission_id, 'amount_cents', p_captured_amount_cents)
  );
end;
$$;

revoke execute on function public.record_mission_capture(uuid, integer) from public, anon, authenticated;
grant execute on function public.record_mission_capture(uuid, integer) to service_role;

-- Absence totale / mission annulee : aucune capture, autorisation liberee.
create or replace function public.record_mission_authorization_canceled(p_mission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission record;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  select m.id, m.title, s.owner_id into v_mission
  from public.missions m join public.structures s on s.id = m.structure_id
  where m.id = p_mission_id
  for update of m;
  if not found then
    return;
  end if;

  update public.missions
  set payment_authorization_status = 'canceled',
      captured_amount_cents = 0,
      captured_at = now()
  where id = p_mission_id;

  perform public.notify(
    v_mission.owner_id, 'mission_authorization_canceled', 'Fonds libérés',
    'Aucun travailleur n''a effectué « ' || v_mission.title || ' » : les fonds bloqués sont libérés, aucun prélèvement.',
    jsonb_build_object('mission_id', p_mission_id)
  );
end;
$$;

revoke execute on function public.record_mission_authorization_canceled(uuid) from public, anon, authenticated;
grant execute on function public.record_mission_authorization_canceled(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Le point de blocage se deplace de la candidature (paiement individuel)
--    a la mission (autorisation globale) : accepter un candidat ne verifie
--    plus AUCUN paiement Stripe individuel, seule l'autorisation de la
--    mission compte. Remplace l'ancien garde stripe_payment_status='paid'.
-- ---------------------------------------------------------------------------
create or replace function public.guard_application_state_and_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
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
    select m.status, m.positions, m.places, m.worker_rate_cents, m.is_solidaire, m.payment_authorization_status
    into v_mission
    from public.missions m
    where m.id = new.mission_id
    for update;

    if not found or v_mission.status <> 'open' then
      raise exception using errcode = '23514', message = 'Cette mission n accepte plus de candidature.';
    end if;

    -- Mission remuneree : l'autorisation bancaire GLOBALE de la mission doit
    -- etre posee (empreinte bancaire) — plus aucune verification individuelle
    -- par candidature, jamais de paiement Stripe candidat par candidat.
    if not v_backend
       and v_mission.payment_authorization_status not in ('not_required', 'authorized') then
      raise exception using errcode = '42501',
        message = 'Le paiement de cette mission n''est pas encore confirmé.';
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
