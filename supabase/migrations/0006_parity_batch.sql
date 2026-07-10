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
