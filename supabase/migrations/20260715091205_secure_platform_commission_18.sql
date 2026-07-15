-- Commission UROSI V1 : 18 % payes par la structure, sans TVA ajoutee.
--
-- Registre analytique des commissions attribuees a UROSI.
-- Ce registre prepare la future reconciliation avec un service
-- de paiement externe, sans dependre d'un prestataire particulier.
-- Il ne constitue pas encore une comptabilite en partie double
-- ni une preuve d'encaissement bancaire reel.

-- ---------------------------------------------------------------------------
-- Parametres : migration non destructive des taux personnalises et TVA prete
-- a etre activee plus tard, mais desactivee aujourd'hui.
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  alter column commission_pct set default 18;

update public.platform_settings
set commission_pct = 18,
    updated_at = now()
where id = true
  and commission_pct = 15;

-- La commission travailleur historique n'est plus appliquee. On ne remplace
-- que l'ancienne valeur par defaut afin de ne pas ecraser une personnalisation.
alter table public.platform_settings
  alter column commission_worker_pct set default 0;

update public.platform_settings
set commission_worker_pct = 0,
    updated_at = now()
where id = true
  and commission_worker_pct = 10;

alter table public.platform_settings
  add column if not exists vat_enabled boolean not null default false,
  add column if not exists vat_pct numeric not null default 0,
  add column if not exists vat_legal_reference text
    default 'TVA non applicable, art. 293 B du CGI';

comment on column public.platform_settings.commission_pct is
  'Commission UROSI payee par la structure. Valeur V1 par defaut : 18 %.';
comment on column public.platform_settings.commission_worker_pct is
  'Champ historique conserve pour compatibilite. Non applique au calcul V1.';
comment on column public.platform_settings.vat_enabled is
  'Activation future de la TVA. Toujours false tant que la franchise en base s applique.';

-- ---------------------------------------------------------------------------
-- Paiement interne et futur rapprochement externe : statuts volontairement
-- separes afin que released ne soit jamais presente comme un virement reel.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.lemonway_accounts') is not null
     and to_regclass('public.payment_accounts') is null then
    alter table public.lemonway_accounts rename to payment_accounts;
  end if;
  if to_regclass('public.payment_accounts') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'payment_accounts'
         and column_name = 'lemonway_wallet_id'
     ) then
    alter table public.payment_accounts
      rename column lemonway_wallet_id to provider_account_id;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_accounts'::regclass
      and conname = 'lemonway_accounts_profile_id_fkey'
  ) then
    alter table public.payment_accounts
      rename constraint lemonway_accounts_profile_id_fkey to payment_accounts_profile_id_fkey;
  end if;
end;
$$;

alter table public.payment_accounts
  add column if not exists payment_provider text;
update public.payment_accounts
set payment_provider = coalesce(payment_provider, 'internal');
comment on table public.payment_accounts is
  'References facultatives de comptes de paiement. Aucun service externe n est impose.';
drop policy if exists "lemonway_accounts: read own" on public.payment_accounts;
drop policy if exists "payment accounts: read own" on public.payment_accounts;
create policy "payment accounts: read own"
  on public.payment_accounts for select to authenticated
  using (profile_id = (select auth.uid()));

alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments
  add column if not exists internal_status text not null default 'pending',
  add column if not exists provider_status text not null default 'not_connected',
  add column if not exists provider_transaction_id text,
  add column if not exists reconciled_at timestamptz;

alter table public.payments drop constraint if exists payments_internal_status_check;
alter table public.payments
  add constraint payments_internal_status_check
  check (internal_status in ('pending', 'released', 'failed', 'refunded'));

alter table public.payments drop constraint if exists payments_provider_status_check;
alter table public.payments
  add constraint payments_provider_status_check
  check (provider_status in ('not_connected', 'pending', 'confirmed', 'failed', 'refunded'));

update public.payments
set internal_status = case
      when status = 'released' then 'released'
      when status = 'failed' then 'failed'
      else 'pending'
    end,
    provider_status = case
      when provider = 'internal' then 'not_connected'
      else provider_status
    end;

create unique index if not exists payments_application_id_key
  on public.payments (application_id);
create unique index if not exists payments_provider_tx_unique
  on public.payments (provider_transaction_id)
  where provider_transaction_id is not null;

comment on column public.payments.status is
  'Statut metier historique interne. Ne prouve aucun transfert bancaire.';
comment on column public.payments.provider is
  'Identifiant technique facultatif. internal designe uniquement la simulation UROSI.';
comment on column public.payments.provider_status is
  'Etat du service externe : not_connected tant qu aucune integration reelle n est active.';

-- Une seule transaction de chaque nature peut etre generee par wallet et
-- candidature. Les doublons historiques eventuels sont retires, puis les
-- soldes sont recalcules a partir du registre des transactions.
with ranked as (
  select id,
         row_number() over (
           partition by wallet_id, application_id, kind
           order by created_at, id
         ) as position
  from public.wallet_transactions
  where application_id is not null
    and kind in ('mission_earning', 'mission_charge', 'commission')
)
delete from public.wallet_transactions wt
using ranked r
where wt.id = r.id and r.position > 1;

update public.wallets w
set balance_cents = coalesce((
  select sum(wt.amount_cents)
  from public.wallet_transactions wt
  where wt.wallet_id = w.id
), 0);

create unique index if not exists wallet_transactions_financial_once
  on public.wallet_transactions (wallet_id, application_id, kind)
  where application_id is not null
    and kind in ('mission_earning', 'mission_charge', 'commission');

-- ---------------------------------------------------------------------------
-- Registre analytique interne des commissions UROSI.
-- ---------------------------------------------------------------------------
create table if not exists public.platform_revenue (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique
    references public.applications (id) on delete restrict,
  payment_id uuid not null unique
    references public.payments (id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 0),
  commission_pct numeric not null check (commission_pct >= 0 and commission_pct <= 40),
  payment_provider text,
  provider_transaction_id text,
  provider_status text,
  reconciled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.platform_revenue
  add column if not exists payment_provider text,
  add column if not exists provider_transaction_id text,
  add column if not exists provider_status text,
  add column if not exists reconciled_at timestamptz;

create unique index if not exists platform_revenue_provider_tx_unique
  on public.platform_revenue (provider_transaction_id)
  where provider_transaction_id is not null;
create index if not exists platform_revenue_created_idx
  on public.platform_revenue (created_at desc);

comment on table public.platform_revenue is
  'Registre analytique interne des commissions attribuees a UROSI. Ne constitue ni une comptabilite en partie double ni une preuve d encaissement bancaire.';
comment on column public.platform_revenue.reconciled_at is
  'Date de rapprochement avec un service externe, nulle pour une simulation interne.';

alter table public.platform_revenue enable row level security;
drop policy if exists "platform revenue: founder read" on public.platform_revenue;
create policy "platform revenue: founder read"
  on public.platform_revenue for select to authenticated
  using ((select public.is_founder()));

revoke all on table public.platform_revenue from public, anon, authenticated;
grant select on table public.platform_revenue to authenticated;

create or replace view public.platform_revenue_total
with (security_invoker = true)
as
select
  coalesce(sum(amount_cents), 0)::bigint as total_cents,
  count(*)::int as operations
from public.platform_revenue;

revoke all on public.platform_revenue_total from public, anon;
grant select on public.platform_revenue_total to authenticated;

-- ---------------------------------------------------------------------------
-- Protection des transitions et des montants.
-- Seul un appel serveur (service_role) peut passer a completed. Les actions
-- SQL d'administration, sans JWT utilisateur, restent possibles.
-- ---------------------------------------------------------------------------
create or replace function public.guard_financial_application_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and auth.uid() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'La completion financiere est reservee au backend UROSI.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_financial_application_completion()
  from public, anon, authenticated;

drop trigger if exists applications_guard_financial_completion on public.applications;
create trigger applications_guard_financial_completion
  before update of status on public.applications
  for each row execute function public.guard_financial_application_completion();

create or replace function public.guard_committed_mission_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    new.worker_rate_cents is distinct from old.worker_rate_cents
    or new.base_rate_cents is distinct from old.base_rate_cents
    or new.pricing_breakdown is distinct from old.pricing_breakdown
    or new.is_solidaire is distinct from old.is_solidaire
  ) and exists (
    select 1
    from public.applications a
    where a.mission_id = old.id
      and a.status in ('accepted', 'in_progress', 'payment_pending', 'completed', 'disputed')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Le montant ne peut plus changer apres engagement d un participant.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_committed_mission_price()
  from public, anon, authenticated;

drop trigger if exists missions_guard_committed_price on public.missions;
create trigger missions_guard_committed_price
  before update of worker_rate_cents, base_rate_cents, pricing_breakdown, is_solidaire
  on public.missions
  for each row execute function public.guard_committed_mission_price();

-- ---------------------------------------------------------------------------
-- Paiement idempotent, neutre et reserve au backend.
-- 100 EUR proposes => 100 EUR travailleur + 18 EUR UROSI = 118 EUR structure.
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

  insert into public.wallet_transactions (
    wallet_id, amount_cents, kind, application_id, label
  ) values
    (v_worker_wallet, v_app.worker_rate_cents, 'mission_earning', p_application_id,
     'Credit interne simule - mission « ' || v_app.title || ' »'),
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
    v_app.worker_id, 'payment', 'Traitement interne enregistre',
    'Un credit interne simule de ' || to_char(v_app.worker_rate_cents / 100.0, 'FM999990.00') ||
      ' EUR est enregistre pour « ' || v_app.title || ' ». Aucun virement externe n est annonce.',
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

revoke execute on function public.process_mission_payment(uuid)
  from public, anon, authenticated;
grant execute on function public.process_mission_payment(uuid) to service_role;

-- Le passage payment_pending -> completed est une operation backend apres J+3.
create or replace function public.release_payment_ready_mission(p_application_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app record;
  v_payment_id uuid;
begin
  if auth.uid() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Execution reservee au backend UROSI.';
  end if;

  select a.id, a.status, a.payment_ready_at, a.actual_end_at,
         a.attendance_status, m.status as mission_status
  into v_app
  from public.applications a
  join public.missions m on m.id = a.mission_id
  where a.id = p_application_id
  for update of a;

  if not found then raise exception using errcode = 'P0002', message = 'Mission introuvable.'; end if;
  if v_app.status = 'completed' then
    select id into v_payment_id from public.payments where application_id = p_application_id;
    return v_payment_id;
  end if;
  if v_app.status <> 'payment_pending'
     or v_app.payment_ready_at is null
     or v_app.payment_ready_at > now() then
    raise exception using errcode = '23514', message = 'Traitement interne pas encore disponible.';
  end if;
  if v_app.mission_status = 'cancelled'
     or v_app.actual_end_at is null
     or v_app.attendance_status <> 'end_confirmed'
     or not exists (
       select 1 from public.attendance_events e
       where e.application_id = p_application_id
         and e.event_type = 'end_confirmed'
         and e.confirmed_time is not null
     ) then
    raise exception using errcode = '23514', message = 'Confirmation de presence insuffisante.';
  end if;
  if exists (
    select 1 from public.mission_reports r
    where r.application_id = p_application_id
      and r.status in ('open', 'awaiting_response', 'reviewing')
      and r.severity in ('high', 'critical')
  ) then
    raise exception using errcode = '23514', message = 'Un signalement bloquant doit etre traite.';
  end if;

  update public.applications set status = 'completed' where id = p_application_id;
  select id into v_payment_id from public.payments where application_id = p_application_id;
  return v_payment_id;
end;
$$;

revoke execute on function public.release_payment_ready_mission(uuid)
  from public, anon, authenticated;
grant execute on function public.release_payment_ready_mission(uuid) to service_role;

-- Compatibilite avec un environnement qui aurait deja applique le centre
-- Fondateur avant cette migration ajoutee. Sur une installation neuve, la
-- migration Founder ulterieure creera directement cette meme version.
do $$
begin
  if to_regprocedure('public.founder_admin_revenue()') is not null then
    execute $ddl$
      create or replace function public.founder_admin_revenue()
      returns jsonb
      language plpgsql
      stable
      security definer
      set search_path = ''
      as $function$
      begin
        perform private.assert_founder();
        return jsonb_build_object(
          'generated_cents', coalesce((select sum(amount_cents) from public.platform_revenue), 0),
          'pending_cents', coalesce((select sum(amount_cents) from public.platform_revenue where reconciled_at is null), 0),
          'month_cents', coalesce((select sum(amount_cents) from public.platform_revenue where created_at >= date_trunc('month', now())), 0),
          'lifetime_cents', coalesce((select sum(amount_cents) from public.platform_revenue), 0),
          'simulated_cents', coalesce((select sum(amount_cents) from public.platform_revenue where provider_status = 'simulated'), 0),
          'confirmed_cents', coalesce((select sum(amount_cents) from public.platform_revenue where provider_status = 'confirmed' and reconciled_at is not null), 0),
          'simulated', exists (select 1 from public.platform_revenue where provider_status = 'simulated')
        );
      end;
      $function$
    $ddl$;
  end if;
end;
$$;
