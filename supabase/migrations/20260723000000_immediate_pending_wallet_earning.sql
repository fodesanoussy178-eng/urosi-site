-- Corrige le flux de paiement interne (wallet simulé) : la confirmation de
-- fin de mission (confirm_attendance_qr / confirm_remote_attendance) ne
-- faisait passer que le STATUT TEXTE de la candidature à 'payment_pending'
-- ("Mission terminée – paiement préparé pour J+3"), sans jamais créer la
-- moindre écriture financière. Le seul point qui crée réellement une ligne
-- wallet_transactions (process_mission_payment) n'était appelé qu'au passage
-- à 'completed', lui-même déclenché uniquement par
-- release_payment_ready_mission(...) — une fonction que rien n'invoquait
-- automatiquement (pas de cron, pas d'edge function dédiée). Résultat : le
-- wallet restait vide indéfiniment après la fin d'une mission.
--
-- Nouveau flux :
--   1. Fin confirmée -> applications.status = 'payment_pending' (inchangé)
--      -> trigger applications_pending_wallet_earning crée IMMÉDIATEMENT un
--         wallet_transactions (kind='mission_earning', fund_status='pending',
--         available_at=payment_ready_at) lié à application_id + wallet du
--         travailleur. Visible tout de suite dans la section "En attente".
--   2. À J+3, release_payment_ready_mission(...) (backend uniquement) passe
--      la candidature à 'completed' -> trigger applications_pay_on_completion
--      -> process_mission_payment PROMEUT cette même ligne 'pending' en
--      'available' (au lieu d'en créer une seconde) -> le trigger existant
--      wallet_apply_transaction incrémente alors wallets.balance_cents.
--
-- Idempotence : la contrainte unique wallet_transactions_financial_once
-- (wallet_id, application_id, kind) empêche toute double écriture, même si
-- le bouton de fin est cliqué plusieurs fois ou si le trigger se redéclenche.

-- ---------------------------------------------------------------------------
-- 1. Date de disponibilité prévue sur chaque mouvement (affichée au
--    travailleur ; permet aussi de sélectionner les mouvements à promouvoir).
-- ---------------------------------------------------------------------------
alter table public.wallet_transactions
  add column if not exists available_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Écriture immédiate et automatique à la confirmation de fin de mission.
-- ---------------------------------------------------------------------------
create or replace function public.trg_create_pending_wallet_earning()
returns trigger
language plpgsql
security definer
set search_path = ''
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
      return new; -- mission solidaire ou montant nul : aucun flux financier
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

drop trigger if exists applications_pending_wallet_earning on public.applications;
create trigger applications_pending_wallet_earning
  after update of status on public.applications
  for each row execute function public.trg_create_pending_wallet_earning();

-- ---------------------------------------------------------------------------
-- 3. process_mission_payment PROMEUT la ligne 'pending' existante au lieu
--    d'en réinsérer une (qui serait ignorée par la contrainte d'unicité et
--    laisserait l'ancienne bloquée en 'pending' pour toujours).
-- ---------------------------------------------------------------------------
create or replace function public.process_mission_payment(p_application_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app record;
  v_pct numeric;
  v_commission integer;
  v_payment_id uuid;
  v_worker_wallet uuid;
  v_owner_wallet uuid;
  v_updated_pending integer;
begin
  if auth.uid() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Execution reservee au backend UROSI.';
  end if;

  select a.id, a.status, a.worker_id, a.attendance_status, a.actual_end_at,
         a.payment_ready_at, m.id as mission_id, m.title, m.worker_rate_cents,
         m.base_rate_cents, m.is_solidaire, m.pricing_breakdown,
         m.structure_id, m.status as mission_status,
         s.owner_id, s.name as structure_name
  into v_app
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = p_application_id
  for update of a;

  if not found then
    raise exception using errcode = 'P0002', message = 'Candidature introuvable.';
  end if;
  if v_app.status <> 'completed' then
    raise exception using errcode = '23514', message = 'La mission doit etre terminee avant traitement.';
  end if;
  if v_app.mission_status = 'cancelled' then
    raise exception using errcode = '23514', message = 'Une mission annulee ne peut pas etre payee.';
  end if;
  if v_app.actual_end_at is null or v_app.attendance_status <> 'end_confirmed' then
    raise exception using errcode = '23514', message = 'La fin de presence doit etre confirmee.';
  end if;
  if not exists (
    select 1 from public.attendance_events e
    where e.application_id = p_application_id
      and e.event_type = 'end_confirmed'
      and e.confirmed_time is not null
  ) then
    raise exception using errcode = '23514', message = 'Preuve serveur de fin de mission absente.';
  end if;
  if exists (
    select 1 from public.mission_reports r
    where r.application_id = p_application_id
      and r.status in ('open', 'awaiting_response', 'reviewing')
      and r.severity in ('high', 'critical')
  ) then
    raise exception using errcode = '23514', message = 'Un signalement bloquant doit etre traite.';
  end if;

  if v_app.is_solidaire or v_app.worker_rate_cents <= 0 then
    return null;
  end if;

  select p.id into v_payment_id
  from public.payments p
  where p.application_id = p_application_id;
  if v_payment_id is not null then
    return v_payment_id;
  end if;

  select commission_pct into v_pct
  from public.platform_settings where id = true;
  v_pct := coalesce(v_pct, 18);
  v_commission := round(v_app.worker_rate_cents * v_pct / 100.0)::integer;

  insert into public.payments (
    application_id, amount_cents, status, internal_status, provider_status,
    structure_id, worker_id, worker_amount_cents, commission_cents,
    bonus_cents, provider, released_at, breakdown
  ) values (
    p_application_id, v_app.worker_rate_cents + v_commission,
    'released', 'released', 'not_connected',
    v_app.structure_id, v_app.worker_id, v_app.worker_rate_cents, v_commission,
    greatest(v_app.worker_rate_cents - coalesce(v_app.base_rate_cents, v_app.worker_rate_cents), 0),
    'internal', now(),
    coalesce(v_app.pricing_breakdown, '{}'::jsonb) || jsonb_build_object(
      'worker_amount_cents', v_app.worker_rate_cents,
      'commission_structure_cents', v_commission,
      'commission_structure_pct', v_pct,
      'vat_enabled', false,
      'vat_cents', 0,
      'total_structure_cents', v_app.worker_rate_cents + v_commission,
      'provider_status', 'not_connected'
    )
  )
  on conflict (application_id) do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    select p.id into v_payment_id
    from public.payments p
    where p.application_id = p_application_id;
    return v_payment_id;
  end if;

  v_worker_wallet := public.ensure_wallet(v_app.worker_id);
  v_owner_wallet := public.ensure_wallet(v_app.owner_id);

  -- Promeut le mouvement 'pending' créé à la confirmation de fin de mission.
  update public.wallet_transactions
  set fund_status = 'available'
  where wallet_id = v_worker_wallet
    and application_id = p_application_id
    and kind = 'mission_earning'
    and fund_status = 'pending';
  get diagnostics v_updated_pending = row_count;

  -- Filet de compatibilité : candidatures déjà en 'payment_pending' avant ce
  -- correctif, sans ligne 'pending' préexistante (le trigger n'existait pas
  -- encore quand leur fin a été confirmée).
  insert into public.wallet_transactions (
    wallet_id, amount_cents, kind, application_id, label
  )
  select v_worker_wallet, v_app.worker_rate_cents, 'mission_earning', p_application_id,
         'Credit interne simule - mission « ' || v_app.title || ' »'
  where v_updated_pending = 0;

  insert into public.wallet_transactions (
    wallet_id, amount_cents, kind, application_id, label
  ) values
    (v_owner_wallet, -v_app.worker_rate_cents, 'mission_charge', p_application_id,
     'Remuneration interne « ' || v_app.title || ' »'),
    (v_owner_wallet, -v_commission, 'commission', p_application_id,
     'Commission UROSI (' || v_pct || ' %) - « ' || v_app.title || ' »')
  on conflict (wallet_id, application_id, kind)
    where application_id is not null
      and kind in ('mission_earning', 'mission_charge', 'commission')
    do nothing;

  insert into public.platform_revenue (
    application_id, payment_id, amount_cents, commission_pct,
    payment_provider, provider_status
  ) values (
    p_application_id, v_payment_id, v_commission, v_pct,
    'internal', 'simulated'
  )
  on conflict (application_id) do nothing;

  perform public.notify(
    v_app.worker_id, 'payment', 'Paiement disponible 💶',
    'Ton virement interne simule de ' || to_char(v_app.worker_rate_cents / 100.0, 'FM999990.00') ||
      ' EUR est maintenant disponible pour « ' || v_app.title || ' ».',
    jsonb_build_object('application_id', p_application_id, 'payment_id', v_payment_id,
      'amount_cents', v_app.worker_rate_cents, 'provider_status', 'not_connected')
  );
  perform public.notify(
    v_app.owner_id, 'payment', 'Traitement interne enregistre',
    to_char((v_app.worker_rate_cents + v_commission) / 100.0, 'FM999990.00') ||
      ' EUR enregistres dans la simulation interne pour « ' || v_app.title || ' ».',
    jsonb_build_object('application_id', p_application_id, 'payment_id', v_payment_id,
      'amount_cents', v_app.worker_rate_cents + v_commission, 'provider_status', 'not_connected')
  );

  return v_payment_id;
end;
$$;

revoke execute on function public.process_mission_payment(uuid) from public, anon, authenticated;
grant execute on function public.process_mission_payment(uuid) to service_role;
