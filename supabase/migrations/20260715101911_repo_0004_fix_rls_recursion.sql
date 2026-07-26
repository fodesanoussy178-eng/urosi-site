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
