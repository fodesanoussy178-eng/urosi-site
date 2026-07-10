-- 0009 : wallet + paiements.
--
-- Modele mandataire : quand une mission est terminee, un paiement est
-- enregistre (remuneration + commission plateforme), le wallet du
-- travailleur est credite et celui de la structure debite. Tout passe par
-- process_mission_payment (security definer, idempotent) — aucun client ne
-- peut ecrire directement dans wallets/wallet_transactions/payments.
-- Le provisionnement (deposit) est une simulation prete a etre remplacee par
-- Lemonway/Stripe via l'Edge Function `psp`.

-- ---------------------------------------------------------------------------
-- platform_settings : commission plateforme configurable (ligne unique)
-- ---------------------------------------------------------------------------
create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  commission_pct numeric not null default 15 check (commission_pct >= 0 and commission_pct <= 40),
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

drop policy if exists "platform_settings: authenticated read" on public.platform_settings;
create policy "platform_settings: authenticated read"
  on public.platform_settings for select
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- wallets + wallet_transactions
-- ---------------------------------------------------------------------------
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  balance_cents bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets (id) on delete cascade,
  amount_cents bigint not null check (amount_cents <> 0),
  kind text not null check (kind in (
    'mission_earning', 'bonus', 'mission_charge', 'commission',
    'deposit', 'withdrawal', 'adjustment'
  )),
  application_id uuid references public.applications (id) on delete set null,
  label text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_wallet_created_idx
  on public.wallet_transactions (wallet_id, created_at desc);
create index if not exists wallet_transactions_application_id_idx
  on public.wallet_transactions (application_id);

alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;

drop policy if exists "wallets: read own" on public.wallets;
create policy "wallets: read own"
  on public.wallets for select
  using (profile_id = auth.uid());

drop policy if exists "wallet_transactions: read own" on public.wallet_transactions;
create policy "wallet_transactions: read own"
  on public.wallet_transactions for select
  using (
    exists (
      select 1 from public.wallets w
      where w.id = wallet_id and w.profile_id = auth.uid()
    )
  );

-- Solde tenu a jour par trigger : la somme des transactions fait foi.
create or replace function public.wallet_apply_transaction()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.wallets
  set balance_cents = balance_cents + new.amount_cents
  where id = new.wallet_id;
  return new;
end;
$$;

drop trigger if exists wallet_transactions_apply on public.wallet_transactions;
create trigger wallet_transactions_apply
  after insert on public.wallet_transactions
  for each row execute function public.wallet_apply_transaction();

-- Un wallet par profil, cree automatiquement.
create or replace function public.ensure_wallet(p_profile_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.wallets (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;
  select id into v_id from public.wallets where profile_id = p_profile_id;
  return v_id;
end;
$$;

revoke execute on function public.ensure_wallet(uuid) from public, anon, authenticated;

create or replace function public.trg_profile_wallet()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.ensure_wallet(new.id);
  return new;
end;
$$;

drop trigger if exists profiles_create_wallet on public.profiles;
create trigger profiles_create_wallet
  after insert on public.profiles
  for each row execute function public.trg_profile_wallet();

-- Backfill des profils existants.
insert into public.wallets (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

-- ---------------------------------------------------------------------------
-- Provisionnement / retrait (simulation PSP — a remplacer par Lemonway/Stripe)
-- ---------------------------------------------------------------------------
create or replace function public.deposit_wallet(p_amount_cents bigint, p_label text default 'Provisionnement')
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_wallet uuid;
  v_balance bigint;
begin
  if p_amount_cents < 100 or p_amount_cents > 500000 then
    raise exception 'Montant invalide (entre 1 € et 5 000 €).';
  end if;
  v_wallet := public.ensure_wallet(auth.uid());
  insert into public.wallet_transactions (wallet_id, amount_cents, kind, label)
  values (v_wallet, p_amount_cents, 'deposit', coalesce(p_label, 'Provisionnement'));
  select balance_cents into v_balance from public.wallets where id = v_wallet;
  return v_balance;
end;
$$;

create or replace function public.withdraw_wallet(p_amount_cents bigint)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_wallet uuid;
  v_balance bigint;
begin
  if p_amount_cents < 100 then
    raise exception 'Montant minimum de retrait : 1 €.';
  end if;
  v_wallet := public.ensure_wallet(auth.uid());
  select balance_cents into v_balance from public.wallets where id = v_wallet;
  if v_balance < p_amount_cents then
    raise exception 'Solde insuffisant.';
  end if;
  insert into public.wallet_transactions (wallet_id, amount_cents, kind, label)
  values (v_wallet, -p_amount_cents, 'withdrawal', 'Retrait vers compte bancaire');
  select balance_cents into v_balance from public.wallets where id = v_wallet;
  return v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- payments : enrichissement (commission, bonus, parties, historique)
-- ---------------------------------------------------------------------------
alter table public.payments add column if not exists structure_id uuid references public.structures (id) on delete set null;
alter table public.payments add column if not exists worker_id uuid references public.profiles (id) on delete set null;
alter table public.payments add column if not exists worker_amount_cents integer not null default 0;
alter table public.payments add column if not exists commission_cents integer not null default 0;
alter table public.payments add column if not exists bonus_cents integer not null default 0;
alter table public.payments add column if not exists provider text not null default 'internal';
alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments
  add constraint payments_provider_check check (provider in ('internal', 'stripe', 'lemonway'));
alter table public.payments add column if not exists released_at timestamptz;
alter table public.payments add column if not exists breakdown jsonb;

create unique index if not exists payments_application_id_key on public.payments (application_id);
create index if not exists payments_structure_id_idx on public.payments (structure_id);
create index if not exists payments_worker_id_idx on public.payments (worker_id);

-- ---------------------------------------------------------------------------
-- process_mission_payment : idempotent, declenche a la completion.
-- amount_cents = cout total structure (remuneration + commission).
-- ---------------------------------------------------------------------------
create or replace function public.process_mission_payment(p_application_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_app record;
  v_pct numeric;
  v_commission integer;
  v_bonus integer;
  v_payment_id uuid;
  v_worker_wallet uuid;
  v_owner_wallet uuid;
begin
  select a.id, a.status, a.worker_id,
         m.id as mission_id, m.title, m.worker_rate_cents, m.base_rate_cents,
         m.is_solidaire, m.pricing_breakdown, m.structure_id,
         s.owner_id, s.name as structure_name
  into v_app
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = p_application_id;

  if not found then
    raise exception 'Candidature introuvable.';
  end if;
  if v_app.status <> 'completed' then
    raise exception 'La mission doit être terminée avant paiement.';
  end if;
  if auth.uid() is not null and auth.uid() not in (v_app.worker_id, v_app.owner_id) then
    raise exception 'Non autorisé.';
  end if;
  if v_app.is_solidaire or v_app.worker_rate_cents <= 0 then
    return null; -- mission solidaire : pas de flux financier
  end if;

  select id into v_payment_id from public.payments where application_id = p_application_id;
  if v_payment_id is not null then
    return v_payment_id; -- deja paye (idempotent)
  end if;

  select commission_pct into v_pct from public.platform_settings where id = true;
  v_commission := round(v_app.worker_rate_cents * coalesce(v_pct, 15) / 100.0)::int;
  v_bonus := greatest(v_app.worker_rate_cents - coalesce(v_app.base_rate_cents, v_app.worker_rate_cents), 0);

  insert into public.payments (
    application_id, amount_cents, status, structure_id, worker_id,
    worker_amount_cents, commission_cents, bonus_cents, provider, released_at, breakdown
  ) values (
    p_application_id, v_app.worker_rate_cents + v_commission, 'released',
    v_app.structure_id, v_app.worker_id,
    v_app.worker_rate_cents, v_commission, v_bonus, 'internal', now(), v_app.pricing_breakdown
  )
  returning id into v_payment_id;

  v_worker_wallet := public.ensure_wallet(v_app.worker_id);
  v_owner_wallet := public.ensure_wallet(v_app.owner_id);

  insert into public.wallet_transactions (wallet_id, amount_cents, kind, application_id, label)
  values
    (v_worker_wallet, v_app.worker_rate_cents, 'mission_earning', p_application_id,
     'Mission « ' || v_app.title || ' » — ' || v_app.structure_name),
    (v_owner_wallet, -v_app.worker_rate_cents, 'mission_charge', p_application_id,
     'Rémunération « ' || v_app.title || ' »'),
    (v_owner_wallet, -v_commission, 'commission', p_application_id,
     'Commission UROSI (' || coalesce(v_pct, 15) || ' %) — « ' || v_app.title || ' »');

  perform public.notify(
    v_app.worker_id, 'payment',
    'Paiement reçu 💶',
    'Ton wallet est crédité de ' || to_char(v_app.worker_rate_cents / 100.0, 'FM999990.00') || ' € pour « ' || v_app.title || ' ».',
    jsonb_build_object('application_id', p_application_id, 'payment_id', v_payment_id, 'amount_cents', v_app.worker_rate_cents)
  );
  perform public.notify(
    v_app.owner_id, 'payment',
    'Paiement effectué',
    to_char((v_app.worker_rate_cents + v_commission) / 100.0, 'FM999990.00') || ' € débités pour « ' || v_app.title || ' » (dont commission).',
    jsonb_build_object('application_id', p_application_id, 'payment_id', v_payment_id, 'amount_cents', v_app.worker_rate_cents + v_commission)
  );

  return v_payment_id;
end;
$$;

revoke execute on function public.process_mission_payment(uuid) from public, anon;

-- Declenchement automatique a la completion de la mission.
create or replace function public.trg_pay_on_completion()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform public.process_mission_payment(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists applications_pay_on_completion on public.applications;
create trigger applications_pay_on_completion
  after update of status on public.applications
  for each row execute function public.trg_pay_on_completion();
