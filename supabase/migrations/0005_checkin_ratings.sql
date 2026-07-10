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
