-- UROSI-T schema: modele mandataire (MEL micro-missions)
-- Aucune colonne ne permet a la plateforme de fixer un prix ou de filtrer
-- l'acces via l'indice de fiabilite. Les plafonds legaux sont des contraintes
-- SQL (CHECK / trigger), pas des regles applicatives contournables.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles : un profil par utilisateur auth.users, cree par le trigger
-- handle_new_user (voir 0002_functions.sql).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'worker' check (role in ('worker', 'structure_admin')),
  is_micro_entrepreneur boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Un profil par utilisateur, cree automatiquement a l''inscription.';

-- ---------------------------------------------------------------------------
-- structures : entites qui publient des missions. Un profil structure_admin
-- peut posseder plusieurs structures (agences, associations...).
-- ---------------------------------------------------------------------------
create table if not exists public.structures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  siret text,
  created_at timestamptz not null default now()
);

create index if not exists structures_owner_id_idx on public.structures (owner_id);

-- ---------------------------------------------------------------------------
-- missions : plafond legal de 5h/mission = contrainte CHECK sur duration_minutes.
-- ---------------------------------------------------------------------------
create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures (id) on delete cascade,
  title text not null,
  detail text,
  city text,
  scheduled_date date not null,
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 300),
  worker_rate_cents integer not null check (worker_rate_cents > 0),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists missions_structure_id_idx on public.missions (structure_id);
create index if not exists missions_status_scheduled_date_idx on public.missions (status, scheduled_date);

-- ---------------------------------------------------------------------------
-- applications : candidature d'un worker a une mission. Plafond legal de
-- 3 jours consecutifs chez la meme structure = trigger (0002_functions.sql),
-- car il faut regarder l'historique, pas seulement la ligne inseree.
-- ---------------------------------------------------------------------------
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  worker_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (mission_id, worker_id)
);

create index if not exists applications_mission_id_idx on public.applications (mission_id);
create index if not exists applications_worker_id_idx on public.applications (worker_id);
create index if not exists applications_worker_status_idx on public.applications (worker_id, status);

-- ---------------------------------------------------------------------------
-- lemonway_accounts / payments : modelisation du cantonnement des fonds.
-- Les appels a l'API Lemonway elle-meme doivent vivre dans des Edge
-- Functions (service_role), jamais cote client. Non branche dans cette passe.
-- ---------------------------------------------------------------------------
create table if not exists public.lemonway_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  lemonway_wallet_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'held', 'released', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists payments_application_id_idx on public.payments (application_id);

-- ---------------------------------------------------------------------------
-- reliability_disputes : contestabilite RGPD Art. 22 sur l'indice de
-- fiabilite calcule automatiquement.
-- ---------------------------------------------------------------------------
create table if not exists public.reliability_disputes (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles (id) on delete cascade,
  description text not null,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists reliability_disputes_worker_id_idx on public.reliability_disputes (worker_id);
