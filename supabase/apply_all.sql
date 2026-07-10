-- UROSI-T : script unique regroupant les migrations, a coller tel quel
-- dans Dashboard Supabase -> SQL Editor -> New query -> Run.
-- Re-executable sans danger si deja applique en partie.

-- ============ 0001_schema.sql ============
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

-- ============ 0002_functions.sql ============
-- Fonctions et triggers portant les regles metier du modele mandataire.

-- ---------------------------------------------------------------------------
-- handle_new_user : cree automatiquement la ligne profiles a l'inscription,
-- avec le role choisi par l'utilisateur (metadonnees passees a signUp()).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'role', 'worker')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- enforce_consecutive_days_cap : un travailleur qui n'est pas
-- micro-entrepreneur ne peut pas enchainer plus de 3 jours consecutifs de
-- missions acceptees pour la meme structure (protection contre le
-- requalification en salariat deguise).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_consecutive_days_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_structure_id uuid;
  v_new_date date;
  v_is_micro boolean;
  v_dates date[];
  v_run integer;
  v_max_run integer;
  v_d date;
  v_prev date;
begin
  select structure_id, scheduled_date into v_structure_id, v_new_date
  from public.missions where id = new.mission_id;

  select coalesce(is_micro_entrepreneur, false) into v_is_micro
  from public.profiles where id = new.worker_id;

  if v_is_micro then
    return new;
  end if;

  select array_agg(distinct m.scheduled_date order by m.scheduled_date)
  into v_dates
  from public.applications a
  join public.missions m on m.id = a.mission_id
  where a.worker_id = new.worker_id
    and a.status = 'accepted'
    and a.id <> new.id
    and m.structure_id = v_structure_id;

  v_dates := array_append(coalesce(v_dates, array[]::date[]), v_new_date);

  select array_agg(distinct d order by d) into v_dates from unnest(v_dates) d;

  v_run := 1;
  v_max_run := 1;
  v_prev := null;

  foreach v_d in array v_dates loop
    if v_prev is not null and v_d = v_prev + 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;
    if v_run > v_max_run then
      v_max_run := v_run;
    end if;
    v_prev := v_d;
  end loop;

  if v_max_run > 3 then
    raise exception 'Plafond legal depasse : 3 jours consecutifs maximum pour la meme structure (travailleur non micro-entrepreneur).'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists applications_consecutive_days_cap on public.applications;
create trigger applications_consecutive_days_cap
  before insert or update of status on public.applications
  for each row
  when (new.status = 'accepted')
  execute function public.enforce_consecutive_days_cap();

-- ---------------------------------------------------------------------------
-- reliability_index : indice de fiabilite calcule par travailleur, en
-- security_invoker pour que chacun ne voie que le sien via les policies RLS
-- de la table sous-jacente (voir 0003_rls.sql).
-- ---------------------------------------------------------------------------
create or replace view public.reliability_index
with (security_invoker = on) as
select
  a.worker_id,
  count(*) filter (where a.status = 'accepted') as accepted_count,
  count(*) filter (where a.status = 'rejected') as rejected_count,
  count(*) filter (where a.status = 'cancelled') as cancelled_count,
  count(*) as total_applications,
  case
    when count(*) filter (where a.status in ('accepted', 'cancelled')) = 0 then null
    else round(
      100.0 * count(*) filter (where a.status = 'accepted')
      / nullif(count(*) filter (where a.status in ('accepted', 'cancelled')), 0),
      1
    )
  end as reliability_score
from public.applications a
group by a.worker_id;

comment on view public.reliability_index is
  'Indice informatif, non-determinant : jamais utilise pour filtrer l''acces aux missions.';

-- ============ 0003_rls.sql ============
-- Row Level Security : chaque table est verrouillee par defaut, seules les
-- policies ci-dessous ouvrent des acces precis. Aucune policy ne filtre sur
-- l'indice de fiabilite (contestabilite RGPD Art. 22 respectee).

alter table public.profiles enable row level security;
alter table public.structures enable row level security;
alter table public.missions enable row level security;
alter table public.applications enable row level security;
alter table public.lemonway_accounts enable row level security;
alter table public.payments enable row level security;
alter table public.reliability_disputes enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists "profiles: structures read applicant profiles" on public.profiles;
create policy "profiles: structures read applicant profiles"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.applications a
      join public.missions m on m.id = a.mission_id
      join public.structures s on s.id = m.structure_id
      where a.worker_id = public.profiles.id
        and s.owner_id = auth.uid()
    )
  );

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- structures
-- ---------------------------------------------------------------------------
drop policy if exists "structures: owner full read" on public.structures;
create policy "structures: owner full read"
  on public.structures for select
  using (owner_id = auth.uid());

drop policy if exists "structures: read via open mission" on public.structures;
create policy "structures: read via open mission"
  on public.structures for select
  using (
    exists (
      select 1 from public.missions m
      where m.structure_id = public.structures.id and m.status = 'open'
    )
  );

drop policy if exists "structures: owner insert" on public.structures;
create policy "structures: owner insert"
  on public.structures for insert
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'structure_admin'
    )
  );

drop policy if exists "structures: owner update" on public.structures;
create policy "structures: owner update"
  on public.structures for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "structures: owner delete" on public.structures;
create policy "structures: owner delete"
  on public.structures for delete
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- missions
-- ---------------------------------------------------------------------------
drop policy if exists "missions: read open or own structure" on public.missions;
create policy "missions: read open or own structure"
  on public.missions for select
  using (
    status = 'open'
    or exists (
      select 1 from public.structures s
      where s.id = public.missions.structure_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists "missions: owner insert" on public.missions;
create policy "missions: owner insert"
  on public.missions for insert
  with check (
    exists (
      select 1 from public.structures s
      where s.id = structure_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists "missions: owner update" on public.missions;
create policy "missions: owner update"
  on public.missions for update
  using (
    exists (
      select 1 from public.structures s
      where s.id = public.missions.structure_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.structures s
      where s.id = structure_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists "missions: owner delete" on public.missions;
create policy "missions: owner delete"
  on public.missions for delete
  using (
    exists (
      select 1 from public.structures s
      where s.id = public.missions.structure_id and s.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- applications
-- ---------------------------------------------------------------------------
drop policy if exists "applications: worker read own" on public.applications;
create policy "applications: worker read own"
  on public.applications for select
  using (worker_id = auth.uid());

drop policy if exists "applications: structure read for own missions" on public.applications;
create policy "applications: structure read for own missions"
  on public.applications for select
  using (
    exists (
      select 1
      from public.missions m
      join public.structures s on s.id = m.structure_id
      where m.id = public.applications.mission_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists "applications: worker apply" on public.applications;
create policy "applications: worker apply"
  on public.applications for insert
  with check (
    worker_id = auth.uid()
    and exists (
      select 1 from public.missions m
      where m.id = mission_id and m.status = 'open'
    )
  );

drop policy if exists "applications: worker cancel own" on public.applications;
create policy "applications: worker cancel own"
  on public.applications for update
  using (worker_id = auth.uid())
  with check (worker_id = auth.uid() and status in ('pending', 'cancelled'));

drop policy if exists "applications: structure accept or reject" on public.applications;
create policy "applications: structure accept or reject"
  on public.applications for update
  using (
    exists (
      select 1
      from public.missions m
      join public.structures s on s.id = m.structure_id
      where m.id = public.applications.mission_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.missions m
      join public.structures s on s.id = m.structure_id
      where m.id = mission_id and s.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- lemonway_accounts / payments : lecture seule cote client, aucune ecriture
-- (creation et mise a jour reservees aux Edge Functions en service_role).
-- ---------------------------------------------------------------------------
drop policy if exists "lemonway_accounts: read own" on public.lemonway_accounts;
create policy "lemonway_accounts: read own"
  on public.lemonway_accounts for select
  using (profile_id = auth.uid());

drop policy if exists "payments: worker reads own" on public.payments;
create policy "payments: worker reads own"
  on public.payments for select
  using (
    exists (
      select 1 from public.applications a
      where a.id = public.payments.application_id and a.worker_id = auth.uid()
    )
  );

drop policy if exists "payments: structure reads own missions payments" on public.payments;
create policy "payments: structure reads own missions payments"
  on public.payments for select
  using (
    exists (
      select 1
      from public.applications a
      join public.missions m on m.id = a.mission_id
      join public.structures s on s.id = m.structure_id
      where a.id = public.payments.application_id and s.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- reliability_disputes
-- ---------------------------------------------------------------------------
drop policy if exists "reliability_disputes: worker read own" on public.reliability_disputes;
create policy "reliability_disputes: worker read own"
  on public.reliability_disputes for select
  using (worker_id = auth.uid());

drop policy if exists "reliability_disputes: worker create own" on public.reliability_disputes;
create policy "reliability_disputes: worker create own"
  on public.reliability_disputes for insert
  with check (worker_id = auth.uid());

-- ============ 0004_fix_rls_recursion.sql ============
-- Corrige une recursion infinie dans les policies RLS : la policy de
-- missions consultait structures, dont la policy consultait missions ->
-- Postgres rejetait toute lecture (42P17), y compris celle du profil.
-- Les sous-requetes inter-tables passent par des fonctions security definer
-- (qui ne re-declenchent pas la RLS), ce qui brise le cycle.

create or replace function public.is_structure_owner(_structure_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.structures s
    where s.id = _structure_id and s.owner_id = auth.uid()
  );
$$;

create or replace function public.owns_mission(_mission_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.missions m
    join public.structures s on s.id = m.structure_id
    where m.id = _mission_id and s.owner_id = auth.uid()
  );
$$;

create or replace function public.mission_is_open(_mission_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.missions m
    where m.id = _mission_id and m.status = 'open'
  );
$$;

create or replace function public.structure_has_open_mission(_structure_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.missions m
    where m.structure_id = _structure_id and m.status = 'open'
  );
$$;

create or replace function public.is_my_applicant(_worker_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.applications a
    join public.missions m on m.id = a.mission_id
    join public.structures s on s.id = m.structure_id
    where a.worker_id = _worker_id and s.owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists "profiles: structures read applicant profiles" on public.profiles;
create policy "profiles: structures read applicant profiles"
  on public.profiles for select
  using (public.is_my_applicant(id));

-- ---------------------------------------------------------------------------
-- structures
-- ---------------------------------------------------------------------------
drop policy if exists "structures: read via open mission" on public.structures;
create policy "structures: read via open mission"
  on public.structures for select
  using (public.structure_has_open_mission(id));

-- ---------------------------------------------------------------------------
-- missions
-- ---------------------------------------------------------------------------
drop policy if exists "missions: read open or own structure" on public.missions;
create policy "missions: read open or own structure"
  on public.missions for select
  using (status = 'open' or public.is_structure_owner(structure_id));

drop policy if exists "missions: owner insert" on public.missions;
create policy "missions: owner insert"
  on public.missions for insert
  with check (public.is_structure_owner(structure_id));

drop policy if exists "missions: owner update" on public.missions;
create policy "missions: owner update"
  on public.missions for update
  using (public.is_structure_owner(structure_id))
  with check (public.is_structure_owner(structure_id));

drop policy if exists "missions: owner delete" on public.missions;
create policy "missions: owner delete"
  on public.missions for delete
  using (public.is_structure_owner(structure_id));

-- ---------------------------------------------------------------------------
-- applications
-- ---------------------------------------------------------------------------
drop policy if exists "applications: structure read for own missions" on public.applications;
create policy "applications: structure read for own missions"
  on public.applications for select
  using (public.owns_mission(mission_id));

drop policy if exists "applications: worker apply" on public.applications;
create policy "applications: worker apply"
  on public.applications for insert
  with check (worker_id = auth.uid() and public.mission_is_open(mission_id));

drop policy if exists "applications: structure accept or reject" on public.applications;
create policy "applications: structure accept or reject"
  on public.applications for update
  using (public.owns_mission(mission_id))
  with check (public.owns_mission(mission_id));

-- ---------------------------------------------------------------------------
-- payments : meme traitement pour la lecture cote structure.
-- ---------------------------------------------------------------------------
drop policy if exists "payments: structure reads own missions payments" on public.payments;
create policy "payments: structure reads own missions payments"
  on public.payments for select
  using (
    exists (
      select 1 from public.applications a
      where a.id = public.payments.application_id
        and public.owns_mission(a.mission_id)
    )
  );

-- ============ 0005_checkin_ratings.sql ============
-- Presence (QR) et notation : chaque candidature acceptee porte un jeton de
-- pointage unique. Le QR affiche une URL de validation qui n'aboutit que si
-- la personne qui scanne est connectee au compte de la structure concernee.
-- Apres la mission, le travailleur la marque terminee et note la structure.

-- ---------------------------------------------------------------------------
-- applications : statut 'completed' + jeton et horodatage de pointage
-- ---------------------------------------------------------------------------
alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications
  add constraint applications_status_check
  check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'completed'));

alter table public.applications
  add column if not exists checkin_token uuid not null default gen_random_uuid();
alter table public.applications
  add column if not exists checked_in_at timestamptz;

-- Le travailleur peut annuler (pending -> cancelled) ou terminer
-- (accepted -> completed) sa propre candidature.
drop policy if exists "applications: worker cancel own" on public.applications;
drop policy if exists "applications: worker cancel or complete own" on public.applications;
create policy "applications: worker cancel or complete own"
  on public.applications for update
  using (worker_id = auth.uid())
  with check (worker_id = auth.uid() and status in ('pending', 'cancelled', 'completed'));

-- ---------------------------------------------------------------------------
-- ratings : note (1-5) donnee par le travailleur a la structure apres une
-- mission terminee. Informatif : jamais utilise pour filtrer l'acces.
-- ---------------------------------------------------------------------------
create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications (id) on delete cascade,
  structure_id uuid not null references public.structures (id) on delete cascade,
  worker_id uuid not null references public.profiles (id) on delete cascade,
  score integer not null check (score between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists ratings_structure_id_idx on public.ratings (structure_id);

alter table public.ratings enable row level security;

drop policy if exists "ratings: authenticated read" on public.ratings;
create policy "ratings: authenticated read"
  on public.ratings for select
  using (auth.uid() is not null);

drop policy if exists "ratings: worker rates own completed application" on public.ratings;
create policy "ratings: worker rates own completed application"
  on public.ratings for insert
  with check (
    worker_id = auth.uid()
    and exists (
      select 1 from public.applications a
      where a.id = application_id
        and a.worker_id = auth.uid()
        and a.status = 'completed'
    )
  );

-- ============ 0006_parity_batch.sql ============
-- Parite avec le prototype v0.5 :
--  - notation bidirectionnelle (travailleur -> structure ET structure ->
--    travailleur), informative et jamais bloquante (inscrit aux CGU)
--  - missions solidaires (0 EUR, reservees aux structures ESS)
--  - signalement de retard et signalement de probleme
--  - champ "a propos" et badge ESS sur les structures

-- ---------------------------------------------------------------------------
-- ratings : direction de la note
-- ---------------------------------------------------------------------------
alter table public.ratings
  add column if not exists direction text not null default 'worker_to_structure'
  check (direction in ('worker_to_structure', 'structure_to_worker'));

alter table public.ratings drop constraint if exists ratings_application_id_key;
drop index if exists ratings_application_id_key;
alter table public.ratings drop constraint if exists ratings_application_direction_key;
alter table public.ratings
  add constraint ratings_application_direction_key unique (application_id, direction);

create index if not exists ratings_worker_id_idx on public.ratings (worker_id);

create or replace function public.owns_completed_application(_application_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.applications a
    join public.missions m on m.id = a.mission_id
    join public.structures s on s.id = m.structure_id
    where a.id = _application_id
      and a.status = 'completed'
      and s.owner_id = auth.uid()
  );
$$;

drop policy if exists "ratings: worker rates own completed application" on public.ratings;
create policy "ratings: worker rates own completed application"
  on public.ratings for insert
  with check (
    direction = 'worker_to_structure'
    and worker_id = auth.uid()
    and exists (
      select 1 from public.applications a
      where a.id = application_id
        and a.worker_id = auth.uid()
        and a.status = 'completed'
    )
  );

drop policy if exists "ratings: structure rates worker on completed application" on public.ratings;
create policy "ratings: structure rates worker on completed application"
  on public.ratings for insert
  with check (
    direction = 'structure_to_worker'
    and public.owns_completed_application(application_id)
  );

-- ---------------------------------------------------------------------------
-- missions : solidaire (0 EUR)
-- ---------------------------------------------------------------------------
alter table public.missions add column if not exists is_solidaire boolean not null default false;
alter table public.missions drop constraint if exists missions_worker_rate_cents_check;
alter table public.missions
  add constraint missions_worker_rate_cents_check
  check (
    (is_solidaire and worker_rate_cents = 0)
    or (not is_solidaire and worker_rate_cents > 0)
  );

-- ---------------------------------------------------------------------------
-- structures : ESS + a propos
-- ---------------------------------------------------------------------------
alter table public.structures add column if not exists is_ess boolean not null default false;
alter table public.structures add column if not exists about text;

-- ---------------------------------------------------------------------------
-- delay_notices : "j'arrive en retard" (informatif, visible par la structure)
-- ---------------------------------------------------------------------------
create table if not exists public.delay_notices (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  minutes integer not null check (minutes > 0 and minutes <= 240),
  created_at timestamptz not null default now()
);

create index if not exists delay_notices_application_id_idx on public.delay_notices (application_id);

alter table public.delay_notices enable row level security;

drop policy if exists "delay_notices: worker notifies own accepted application" on public.delay_notices;
create policy "delay_notices: worker notifies own accepted application"
  on public.delay_notices for insert
  with check (
    exists (
      select 1 from public.applications a
      where a.id = application_id
        and a.worker_id = auth.uid()
        and a.status = 'accepted'
    )
  );

drop policy if exists "delay_notices: worker reads own" on public.delay_notices;
create policy "delay_notices: worker reads own"
  on public.delay_notices for select
  using (
    exists (
      select 1 from public.applications a
      where a.id = public.delay_notices.application_id and a.worker_id = auth.uid()
    )
  );

drop policy if exists "delay_notices: structure reads for own missions" on public.delay_notices;
create policy "delay_notices: structure reads for own missions"
  on public.delay_notices for select
  using (
    exists (
      select 1 from public.applications a
      where a.id = public.delay_notices.application_id
        and public.owns_mission(a.mission_id)
    )
  );

-- ---------------------------------------------------------------------------
-- reports : signalement d'un probleme par le travailleur. Ne penalise
-- jamais : aucune policy ne s'appuie dessus pour filtrer quoi que ce soit.
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  worker_id uuid not null references public.profiles (id) on delete cascade,
  motif text not null check (motif in ('absent', 'conditions', 'securite', 'autre')),
  note text,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved')),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

drop policy if exists "reports: worker creates own" on public.reports;
create policy "reports: worker creates own"
  on public.reports for insert
  with check (
    worker_id = auth.uid()
    and exists (
      select 1 from public.applications a
      where a.id = application_id and a.worker_id = auth.uid()
    )
  );

drop policy if exists "reports: worker reads own" on public.reports;
create policy "reports: worker reads own"
  on public.reports for select
  using (worker_id = auth.uid());

