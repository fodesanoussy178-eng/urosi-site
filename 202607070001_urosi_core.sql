create extension if not exists "pgcrypto";

do $$ begin
  create type public.app_role as enum ('worker', 'structure', 'admin');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.verification_status as enum ('pending', 'verified', 'rejected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.identity_status as enum ('not_started', 'pending', 'verified', 'rejected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.mission_duration as enum ('hours', '1_day', '2_days', '3_days');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.mission_status as enum ('draft', 'published', 'assigned', 'completed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.application_status as enum ('pending', 'accepted', 'rejected', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.mission_event_type as enum (
    'created',
    'published',
    'applied',
    'accepted',
    'rejected',
    'started',
    'completed',
    'reported',
    'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.wallet_transaction_type as enum ('hold', 'release', 'payout', 'refund', 'adjustment');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.wallet_transaction_status as enum ('pending', 'succeeded', 'failed', 'cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  phone text,
  email_verified boolean not null default false,
  phone_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null,
  first_name text,
  last_name text,
  birth_date date,
  address text,
  city text,
  postal_code text,
  phone text,
  identity_status public.identity_status not null default 'not_started',
  iban_holder_name text,
  iban_last4 text,
  kyc_level smallint not null default 1 check (kyc_level between 1 and 3),
  dac7_status public.identity_status not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.structures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  legal_name text,
  siren text not null,
  siret text not null,
  address text not null,
  city text,
  postal_code text,
  phone text,
  verification_status public.verification_status not null default 'pending',
  verification_notes text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint structures_siren_format check (siren ~ '^[0-9]{9}$'),
  constraint structures_siret_format check (siret ~ '^[0-9]{14}$')
);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures(id) on delete cascade,
  title text not null,
  description text,
  address text not null,
  city text,
  postal_code text,
  starts_at timestamptz,
  duration public.mission_duration not null,
  hourly_rate_cents integer not null default 0 check (hourly_rate_cents >= 0),
  total_amount_cents integer not null default 0 check (total_amount_cents >= 0),
  status public.mission_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  worker_id uuid not null references public.profiles(id) on delete cascade,
  status public.application_status not null default 'pending',
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, worker_id)
);

create table if not exists public.mission_events (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type public.mission_event_type not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  worker_id uuid references public.profiles(id) on delete cascade,
  structure_id uuid references public.structures(id) on delete cascade,
  rating smallint check (rating between 1 and 5),
  has_issue boolean not null default false,
  issue_reason text,
  comment text,
  created_at timestamptz not null default now(),
  constraint review_has_target check (worker_id is not null or structure_id is not null)
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id uuid references public.missions(id) on delete set null,
  amount_cents integer not null,
  transaction_type public.wallet_transaction_type not null,
  status public.wallet_transaction_status not null default 'pending',
  provider text,
  provider_reference text,
  created_at timestamptz not null default now()
);

create index if not exists structures_owner_id_idx on public.structures(owner_id);
create index if not exists missions_structure_id_idx on public.missions(structure_id);
create index if not exists missions_status_idx on public.missions(status);
create index if not exists applications_mission_id_idx on public.applications(mission_id);
create index if not exists applications_worker_id_idx on public.applications(worker_id);
create index if not exists mission_events_mission_id_idx on public.mission_events(mission_id);
create index if not exists reviews_mission_id_idx on public.reviews(mission_id);
create index if not exists wallet_transactions_user_id_idx on public.wallet_transactions(user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_users_updated_at on public.users;
create trigger touch_users_updated_at
before update on public.users
for each row execute function public.touch_updated_at();

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists touch_structures_updated_at on public.structures;
create trigger touch_structures_updated_at
before update on public.structures
for each row execute function public.touch_updated_at();

drop trigger if exists touch_missions_updated_at on public.missions;
create trigger touch_missions_updated_at
before update on public.missions
for each row execute function public.touch_updated_at();

drop trigger if exists touch_applications_updated_at on public.applications;
create trigger touch_applications_updated_at
before update on public.applications
for each row execute function public.touch_updated_at();

alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.structures enable row level security;
alter table public.missions enable row level security;
alter table public.applications enable row level security;
alter table public.mission_events enable row level security;
alter table public.reviews enable row level security;
alter table public.wallet_transactions enable row level security;

drop policy if exists "users own row" on public.users;
create policy "users own row"
on public.users
for all
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "profiles own row" on public.profiles;
create policy "profiles own row"
on public.profiles
for all
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "structures readable by authenticated" on public.structures;
create policy "structures readable by authenticated"
on public.structures
for select
to authenticated
using (true);

drop policy if exists "structures managed by owner" on public.structures;
create policy "structures managed by owner"
on public.structures
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "missions readable by authenticated" on public.missions;
create policy "missions readable by authenticated"
on public.missions
for select
to authenticated
using (status in ('published', 'assigned', 'completed'));

drop policy if exists "missions managed by structure owner" on public.missions;
create policy "missions managed by structure owner"
on public.missions
for all
to authenticated
using (
  exists (
    select 1 from public.structures s
    where s.id = missions.structure_id
      and s.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.structures s
    where s.id = missions.structure_id
      and s.owner_id = (select auth.uid())
      and s.verification_status in ('pending', 'verified')
  )
);

drop policy if exists "applications readable by participants" on public.applications;
create policy "applications readable by participants"
on public.applications
for select
to authenticated
using (
  worker_id = (select auth.uid())
  or exists (
    select 1
    from public.missions m
    join public.structures s on s.id = m.structure_id
    where m.id = applications.mission_id
      and s.owner_id = (select auth.uid())
  )
);

drop policy if exists "workers create applications" on public.applications;
create policy "workers create applications"
on public.applications
for insert
to authenticated
with check (worker_id = (select auth.uid()));

drop policy if exists "participants update applications" on public.applications;
create policy "participants update applications"
on public.applications
for update
to authenticated
using (
  worker_id = (select auth.uid())
  or exists (
    select 1
    from public.missions m
    join public.structures s on s.id = m.structure_id
    where m.id = applications.mission_id
      and s.owner_id = (select auth.uid())
  )
);

drop policy if exists "mission events readable by participants" on public.mission_events;
create policy "mission events readable by participants"
on public.mission_events
for select
to authenticated
using (
  actor_id = (select auth.uid())
  or exists (
    select 1
    from public.missions m
    join public.structures s on s.id = m.structure_id
    where m.id = mission_events.mission_id
      and s.owner_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.applications a
    where a.mission_id = mission_events.mission_id
      and a.worker_id = (select auth.uid())
  )
);

drop policy if exists "mission events inserted by authenticated" on public.mission_events;
create policy "mission events inserted by authenticated"
on public.mission_events
for insert
to authenticated
with check (actor_id = (select auth.uid()));

drop policy if exists "reviews readable by authenticated" on public.reviews;
create policy "reviews readable by authenticated"
on public.reviews
for select
to authenticated
using (true);

drop policy if exists "reviews inserted by participants" on public.reviews;
create policy "reviews inserted by participants"
on public.reviews
for insert
to authenticated
with check (
  reviewer_id = (select auth.uid())
  and (
    exists (
      select 1
      from public.applications a
      where a.mission_id = reviews.mission_id
        and a.worker_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.missions m
      join public.structures s on s.id = m.structure_id
      where m.id = reviews.mission_id
        and s.owner_id = (select auth.uid())
    )
  )
);

drop policy if exists "wallet transactions own row" on public.wallet_transactions;
create policy "wallet transactions own row"
on public.wallet_transactions
for select
to authenticated
using (user_id = (select auth.uid()));
