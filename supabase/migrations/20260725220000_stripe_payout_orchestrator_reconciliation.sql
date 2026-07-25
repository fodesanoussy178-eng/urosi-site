-- Orchestrateur de paiement J+3 — reconciliation et completion (STAGING).
--
-- Contexte : deux chemins de finalisation de mission coexistaient sans
-- jamais avoir tourne automatiquement (aucun cron cote infra) :
--   - release_payment_ready_mission / process_mission_payment : simulation
--     interne (wallet_transactions), appelee par l'edge function
--     release-internal-payments.
--   - record_stripe_mission_payment : Transfer Stripe reel (separate charges
--     and transfers, comptes Express, idempotence double), appelee par
--     release-due-payments.
--
-- Decision : release-due-payments devient le SEUL chemin qui fait passer une
-- candidature payante de payment_pending a completed. release-internal-
-- payments est recentree sur son autre role (verification CV + publication
-- des avis en retard), sa boucle de paiement est retiree.
--
-- release_payment_ready_mission est CONSERVEE telle quelle (comme demande) :
-- c'est desormais release-due-payments qui l'appelle pour les missions
-- SOLIDAIRES (aucun transfert Stripe a faire, juste la transition de statut
-- pour que la mission compte dans le CV vivant).
--
-- Le "wallet" reste un historique de mouvements (onglet Historique / CV
-- vivant), mais N'EST PLUS la source de verite du solde affiche : celui-ci
-- devient un calcul en direct sur le compte connecte Stripe (transferts
-- recus - payouts effectues), lu par l'edge function stripe-worker-balance.
-- On evite ainsi la divergence structurelle que maintenir un solde parallele
-- en base finirait inevitablement par produire.

-- ---------------------------------------------------------------------------
-- 1. record_stripe_mission_payment : ecrit aussi platform_revenue (meme
--    transaction que le credit travailleur — les deux commit ou rollback
--    ensemble, c'est deja garanti par le fait que tout est dans la meme
--    fonction plpgsql) et PROMEUT la ligne wallet_transactions 'pending'
--    deja creee a la confirmation de fin de mission, pour que l'historique
--    ne reste jamais bloque sur "en attente" alors que Stripe a paye.
-- ---------------------------------------------------------------------------
create or replace function public.record_stripe_mission_payment(
  p_application_id uuid,
  p_payment_intent_id text,
  p_charge_id text default null,
  p_transfer_id text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app record;
  v_pct numeric;
  v_commission integer;
  v_bonus integer;
  v_payment_id uuid;
  v_worker_wallet uuid;
  v_updated_pending integer;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  select a.id, a.status, a.worker_id,
         m.id as mission_id, m.title, m.worker_rate_cents, m.base_rate_cents,
         m.is_solidaire, m.pricing_breakdown, m.structure_id,
         s.owner_id, s.name as structure_name
  into v_app
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = p_application_id
  for update of a;

  if not found then
    raise exception 'Candidature introuvable.';
  end if;
  if v_app.status not in ('payment_pending', 'completed') then
    raise exception 'La mission doit être en attente de paiement (statut : %).', v_app.status;
  end if;
  if v_app.is_solidaire or v_app.worker_rate_cents <= 0 then
    return null;
  end if;

  select id into v_payment_id from public.payments where application_id = p_application_id;
  if v_payment_id is not null then
    return v_payment_id;
  end if;

  select commission_pct into v_pct from public.platform_settings where id = true;
  v_pct := coalesce(v_pct, 18);
  v_commission := round(v_app.worker_rate_cents * v_pct / 100.0)::int;
  v_bonus := greatest(v_app.worker_rate_cents - coalesce(v_app.base_rate_cents, v_app.worker_rate_cents), 0);

  insert into public.payments (
    application_id, amount_cents, status, internal_status, provider_status,
    structure_id, worker_id,
    worker_amount_cents, commission_cents, bonus_cents, provider, released_at,
    breakdown, stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id
  ) values (
    p_application_id, v_app.worker_rate_cents + v_commission, 'released',
    'released', 'confirmed',
    v_app.structure_id, v_app.worker_id,
    v_app.worker_rate_cents, v_commission, v_bonus, 'stripe', now(),
    v_app.pricing_breakdown, p_payment_intent_id, p_charge_id, p_transfer_id
  )
  returning id into v_payment_id;

  update public.applications
  set status = 'completed'
  where id = p_application_id
    and status = 'payment_pending';

  -- Historique fidele : la ligne "en attente" creee a la confirmation de fin
  -- de mission (trg_create_pending_wallet_earning) devient "disponible" —
  -- jamais recree, jamais dupliquee (meme mecanisme que process_mission_payment).
  v_worker_wallet := (select id from public.wallets where profile_id = v_app.worker_id);
  if v_worker_wallet is not null then
    update public.wallet_transactions
    set fund_status = 'available'
    where wallet_id = v_worker_wallet
      and application_id = p_application_id
      and kind = 'mission_earning'
      and fund_status = 'pending';
    get diagnostics v_updated_pending = row_count;
  end if;

  -- Ecriture de revenu plateforme, meme transaction que le credit travailleur :
  -- si l'un echoue, les deux rollback (une seule fonction, une seule transaction).
  insert into public.platform_revenue (
    application_id, payment_id, amount_cents, commission_pct,
    payment_provider, provider_transaction_id, provider_status
  ) values (
    p_application_id, v_payment_id, v_commission, v_pct,
    'stripe', p_transfer_id, 'confirmed'
  )
  on conflict (application_id) do nothing;

  perform public.notify(
    v_app.worker_id, 'payment',
    'Paiement envoyé 💶',
    'Ton virement Stripe de ' || to_char(v_app.worker_rate_cents / 100.0, 'FM999990.00')
      || ' € est en route pour « ' || v_app.title || ' ».',
    jsonb_build_object(
      'application_id', p_application_id,
      'payment_id', v_payment_id,
      'amount_cents', v_app.worker_rate_cents,
      'provider', 'stripe',
      'transfer_id', p_transfer_id
    )
  );

  return v_payment_id;
end;
$$;

revoke execute on function public.record_stripe_mission_payment(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_stripe_mission_payment(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Compteur de tentatives + plafond de retry. Un Transfer qui echoue reste
--    en payment_pending et sera retente au prochain passage horaire du cron,
--    jusqu'a 5 tentatives — au-dela, bloque explicitement pour revue Fondateur
--    (jamais de boucle d'echec silencieuse infinie).
-- ---------------------------------------------------------------------------
alter table public.applications add column if not exists payment_attempts integer not null default 0;
alter table public.applications add column if not exists payment_blocked_reason text;

create or replace function public.record_payment_attempt_failure(p_application_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_title text;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  update public.applications
  set payment_attempts = payment_attempts + 1,
      payment_blocked_reason = case when payment_attempts + 1 >= 5 then p_reason else payment_blocked_reason end
  where id = p_application_id
  returning payment_attempts into v_attempts;

  if v_attempts >= 5 then
    select m.title into v_title
    from public.applications a join public.missions m on m.id = a.mission_id
    where a.id = p_application_id;

    perform private.log_founder_action(
      'payment_max_retries_exceeded',
      'application',
      p_application_id,
      v_title,
      jsonb_build_object('attempts', v_attempts, 'last_error', p_reason)
    );
  end if;

  return v_attempts;
end;
$$;

revoke execute on function public.record_payment_attempt_failure(uuid, text) from public, anon, authenticated;
grant execute on function public.record_payment_attempt_failure(uuid, text) to service_role;

-- Marque un transfert comme echoue APRES coup (webhook transfer.failed,
-- asynchrone : le Transfer avait reussi a la creation puis a echoue cote
-- Stripe). Toujours visible cote Fondateur, jamais silencieux.
alter table public.payments add column if not exists transfer_status text not null default 'succeeded'
  check (transfer_status in ('succeeded', 'failed'));

create or replace function public.record_transfer_failure(p_transfer_id text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
  v_title text;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  select p.id, p.application_id, p.worker_id
  into v_payment
  from public.payments p
  where p.stripe_transfer_id = p_transfer_id
  for update;

  if not found then
    return; -- transfert inconnu (hors perimetre UROSI ou deja traite autrement)
  end if;

  update public.payments set transfer_status = 'failed' where id = v_payment.id;

  select m.title into v_title
  from public.applications a join public.missions m on m.id = a.mission_id
  where a.id = v_payment.application_id;

  perform public.notify(
    v_payment.worker_id, 'payment_issue', 'Virement à vérifier',
    'Le virement pour « ' || coalesce(v_title, 'ta mission') || ' » a rencontré un problème. Le support UROSI a été alerté.',
    jsonb_build_object('application_id', v_payment.application_id, 'transfer_id', p_transfer_id, 'reason', p_reason)
  );

  perform private.log_founder_action(
    'stripe_transfer_failed',
    'payment',
    v_payment.id,
    v_title,
    jsonb_build_object('transfer_id', p_transfer_id, 'reason', p_reason, 'application_id', v_payment.application_id)
  );
end;
$$;

revoke execute on function public.record_transfer_failure(text, text) from public, anon, authenticated;
grant execute on function public.record_transfer_failure(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Virements manuels ("Demander un virement") : ledger cote UROSI des
--    Payout Stripe QUE NOUS avons crees (jamais une source de solde — le
--    solde affiche vient de stripe.balance.retrieve — mais necessaire pour
--    l'historique, l'audit Fondateur et la reconciliation webhook).
-- ---------------------------------------------------------------------------
create table if not exists public.worker_payouts (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles (id) on delete cascade,
  stripe_account_id text not null,
  stripe_payout_id text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'eur',
  status text not null default 'pending' check (status in ('pending', 'in_transit', 'paid', 'failed', 'canceled')),
  failure_reason text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists worker_payouts_worker_idx on public.worker_payouts (worker_id, requested_at desc);
alter table public.worker_payouts enable row level security;

drop policy if exists "worker_payouts: owner reads own" on public.worker_payouts;
create policy "worker_payouts: owner reads own"
  on public.worker_payouts for select
  to authenticated
  using (worker_id = auth.uid());
-- Aucune policy insert/update/delete cote client : uniquement via les RPC
-- service_role ci-dessous (stripe-request-payout, webhook stripe-webhook).

create or replace function public.record_worker_payout_request(
  p_worker_id uuid,
  p_stripe_account_id text,
  p_stripe_payout_id text,
  p_amount_cents integer
) returns public.worker_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.worker_payouts;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  insert into public.worker_payouts (worker_id, stripe_account_id, stripe_payout_id, amount_cents)
  values (p_worker_id, p_stripe_account_id, p_stripe_payout_id, p_amount_cents)
  on conflict (stripe_payout_id) do update set updated_at = now()
  returning * into v_row;

  perform public.notify(
    p_worker_id, 'payout_requested', 'Virement demandé',
    'Ton virement de ' || to_char(p_amount_cents / 100.0, 'FM999990.00') || ' € vers ton compte bancaire est en cours.',
    jsonb_build_object('payout_id', v_row.id, 'stripe_payout_id', p_stripe_payout_id, 'amount_cents', p_amount_cents)
  );

  return v_row;
end;
$$;

revoke execute on function public.record_worker_payout_request(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_worker_payout_request(uuid, text, text, integer) to service_role;

create or replace function public.update_worker_payout_status(
  p_stripe_payout_id text,
  p_status text,
  p_failure_reason text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.worker_payouts;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;
  if p_status not in ('pending', 'in_transit', 'paid', 'failed', 'canceled') then
    raise exception 'Statut de virement invalide : %', p_status;
  end if;

  update public.worker_payouts
  set status = p_status,
      failure_reason = case when p_status = 'failed' then p_failure_reason else failure_reason end,
      updated_at = now()
  where stripe_payout_id = p_stripe_payout_id
  returning * into v_row;

  if v_row.id is null then
    return; -- payout inconnu (cree hors UROSI, ou pas encore synchronise)
  end if;

  if p_status = 'paid' then
    perform public.notify(
      v_row.worker_id, 'payout_paid', 'Virement effectué ✅',
      'Ton virement de ' || to_char(v_row.amount_cents / 100.0, 'FM999990.00') || ' € est arrivé sur ton compte bancaire.',
      jsonb_build_object('payout_id', v_row.id, 'stripe_payout_id', p_stripe_payout_id)
    );
  elsif p_status = 'failed' then
    perform public.notify(
      v_row.worker_id, 'payout_failed', 'Virement échoué',
      'Ton virement de ' || to_char(v_row.amount_cents / 100.0, 'FM999990.00') || ' € a échoué. Vérifie ton IBAN dans tes réglages.',
      jsonb_build_object('payout_id', v_row.id, 'stripe_payout_id', p_stripe_payout_id, 'reason', p_failure_reason)
    );
    perform private.log_founder_action(
      'stripe_payout_failed', 'worker_payout', v_row.id, null,
      jsonb_build_object('worker_id', v_row.worker_id, 'stripe_payout_id', p_stripe_payout_id, 'reason', p_failure_reason)
    );
  end if;
end;
$$;

revoke execute on function public.update_worker_payout_status(text, text, text) from public, anon, authenticated;
grant execute on function public.update_worker_payout_status(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Observabilite du cron : chaque execution de release-due-payments
--    journalisee (horodatage, missions traitees, montants, erreurs).
-- ---------------------------------------------------------------------------
create table if not exists public.cron_execution_log (
  id bigint generated always as identity primary key,
  job_name text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  checked_count integer not null default 0,
  released_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  total_amount_cents bigint not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists cron_execution_log_job_idx on public.cron_execution_log (job_name, started_at desc);
alter table public.cron_execution_log enable row level security;

drop policy if exists "cron_execution_log: founder read" on public.cron_execution_log;
create policy "cron_execution_log: founder read"
  on public.cron_execution_log for select
  to authenticated
  using (public.is_founder());

create or replace function public.record_cron_execution(
  p_job_name text,
  p_started_at timestamptz,
  p_checked integer,
  p_released integer,
  p_skipped integer,
  p_failed integer,
  p_total_amount_cents bigint default 0,
  p_error text default null
) returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.cron_execution_log (
    job_name, started_at, finished_at, checked_count, released_count,
    skipped_count, failed_count, total_amount_cents, error
  ) values (
    p_job_name, p_started_at, now(), p_checked, p_released, p_skipped, p_failed,
    p_total_amount_cents, p_error
  )
  returning id;
$$;

revoke execute on function public.record_cron_execution(text, timestamptz, integer, integer, integer, integer, bigint, text) from public, anon, authenticated;
grant execute on function public.record_cron_execution(text, timestamptz, integer, integer, integer, integer, bigint, text) to service_role;

create or replace function public.founder_cron_execution_log(p_job_name text default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_founder();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.started_at desc)
    from (
      select *
      from public.cron_execution_log
      where p_job_name is null or job_name = p_job_name
      order by started_at desc
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.founder_cron_execution_log(text, integer) from public, anon, authenticated;
grant execute on function public.founder_cron_execution_log(text, integer) to authenticated;
