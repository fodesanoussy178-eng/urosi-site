-- Phase 0 — missions solidaires.
--
-- Strictement additif : aucune table, colonne, fonction ou policy existante
-- n'est supprimee. La couche remuneree reste intacte en base ; elle est
-- seulement masquee cote interface (VITE_FEATURE_PAID_LAYER).
--
-- Trois familles de missions coexistent :
--   external_solidarity_mission -> public.external_missions (cette migration)
--   urosi_solidarity_mission    -> public.missions ou is_solidaire = true
--   paid_mission                -> public.missions ou is_solidaire = false
--                                  (inactive et invisible en phase 0)
-- Une future famille s'ajoute sans migration des donnees existantes.

-- ---------------------------------------------------------------------------
-- 1. Missions importees depuis des plateformes partenaires (API Engagement…)
-- ---------------------------------------------------------------------------
create table if not exists public.external_missions (
  id uuid primary key default gen_random_uuid(),
  source text not null check (length(source) between 2 and 60),
  external_id text not null check (length(external_id) between 1 and 200),
  title text not null check (length(title) between 2 and 300),
  description text,
  organization_name text,
  organization_logo_url text,
  -- Priorite d'image : photo de mission (si licite) > illustration de la
  -- source > illustration UROSI de la categorie (cote client).
  image_url text,
  source_illustration_url text,
  category text not null default 'autre',
  city text,
  postal_code text,
  address text,
  lat double precision,
  lng double precision,
  starts_at timestamptz,
  ends_at timestamptz,
  schedule_text text,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  places integer check (places is null or places >= 0),
  application_url text not null check (application_url ~* '^https://'),
  source_url text,
  is_active boolean not null default true,
  raw jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists external_missions_active_idx
  on public.external_missions (is_active, starts_at);

alter table public.external_missions enable row level security;

-- Lecture publique : c'est le catalogue visible avant meme l'inscription.
drop policy if exists "external_missions: public read active" on public.external_missions;
create policy "external_missions: public read active"
  on public.external_missions for select
  to anon, authenticated
  using (is_active);

-- Aucune policy d'ecriture : seul l'import (service_role) ecrit.
grant select on public.external_missions to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Candidatures externes : UROSI ne sait QUE ce que la personne a fait
--    (clic, puis declarations). Aucun faux statut de validation.
-- ---------------------------------------------------------------------------
create table if not exists public.external_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  external_mission_id uuid not null references public.external_missions (id) on delete cascade,
  source text not null,
  clicked_at timestamptz not null default now(),
  status text not null default 'external_application_started'
    check (status in (
      'external_application_started', -- redirige vers la plateforme partenaire
      'accepted_declared',             -- la personne declare avoir ete acceptee
      'completed_declared',            -- la personne declare avoir realise la mission
      'verified',                      -- verification UROSI reelle (jamais auto-declaree)
      'withdrawn'                      -- la personne retire sa candidature
    )),
  status_updated_at timestamptz not null default now(),
  accepted_declared_at timestamptz,
  completed_declared_at timestamptz,
  declared_minutes integer check (declared_minutes is null or declared_minutes between 1 and 4320),
  verified_at timestamptz,
  verified_by uuid references public.profiles (id),
  verification_note text,
  unique (user_id, external_mission_id)
);

create index if not exists external_applications_user_idx
  on public.external_applications (user_id, clicked_at desc);

alter table public.external_applications enable row level security;

drop policy if exists "external_applications: own read" on public.external_applications;
create policy "external_applications: own read"
  on public.external_applications for select
  to authenticated
  using (user_id = (select auth.uid()) or public.has_founder_access());

drop policy if exists "external_applications: own insert" on public.external_applications;
create policy "external_applications: own insert"
  on public.external_applications for insert
  to authenticated
  with check (user_id = (select auth.uid()) and status = 'external_application_started');

drop policy if exists "external_applications: own update" on public.external_applications;
create policy "external_applications: own update"
  on public.external_applications for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.external_applications to authenticated;

-- Une mission desactivee (plus publiee par la source) reste lisible par
-- celles et ceux qui y ont candidate : leur parcours ne perd pas l'info.
drop policy if exists "external_missions: applicant read" on public.external_missions;
create policy "external_missions: applicant read"
  on public.external_missions for select
  to authenticated
  using (
    exists (
      select 1 from public.external_applications ea
      where ea.external_mission_id = external_missions.id
        and ea.user_id = (select auth.uid())
    )
  );

-- Garde : une declaration n'est jamais une verification. Le participant ne
-- peut ni ecrire 'verified' ni toucher aux champs de verification, ni
-- revenir sur une experience deja verifiee.
create or replace function public.guard_external_application_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean :=
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or public.has_founder_access();
begin
  if tg_op = 'INSERT' then
    new.clicked_at := now();
    new.status_updated_at := now();
    if not v_trusted then
      new.verified_at := null;
      new.verified_by := null;
      new.verification_note := null;
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.external_mission_id is distinct from old.external_mission_id
     or new.source is distinct from old.source
     or new.clicked_at is distinct from old.clicked_at then
    raise exception using errcode = '42501', message = 'Candidature externe non modifiable.';
  end if;

  if not v_trusted then
    if old.status = 'verified' then
      raise exception using errcode = '42501', message = 'Expérience déjà vérifiée par UROSI.';
    end if;
    if new.status = 'verified'
       or new.verified_at is distinct from old.verified_at
       or new.verified_by is distinct from old.verified_by
       or new.verification_note is distinct from old.verification_note then
      raise exception using errcode = '42501', message = 'Seule UROSI peut vérifier une expérience.';
    end if;
  end if;

  if new.status is distinct from old.status then
    new.status_updated_at := now();
    if new.status = 'accepted_declared' and new.accepted_declared_at is null then
      new.accepted_declared_at := now();
    end if;
    if new.status = 'completed_declared' and new.completed_declared_at is null then
      new.completed_declared_at := now();
      new.accepted_declared_at := coalesce(new.accepted_declared_at, now());
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_external_application on public.external_applications;
create trigger trg_guard_external_application
  before insert or update on public.external_applications
  for each row execute function public.guard_external_application_update();

-- Verification reelle par l'equipe UROSI (Centre Fondateur).
create or replace function public.founder_verify_external_application(
  p_application_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_founder_access() then
    raise exception using errcode = '42501', message = 'Réservé à l''équipe UROSI.';
  end if;
  update public.external_applications
  set status = 'verified',
      verified_at = now(),
      verified_by = auth.uid(),
      verification_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_application_id;
  if not found then
    raise exception 'Candidature introuvable.';
  end if;
end;
$$;

revoke all on function public.founder_verify_external_application(uuid, text) from public, anon;
grant execute on function public.founder_verify_external_application(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Profil participant leger : photo facultative + centres d'interet.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists interests text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: owner upload" on storage.objects;
create policy "avatars: owner upload"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: owner replace" on storage.objects;
create policy "avatars: owner replace"
on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete"
on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 4. Vocabulaire : la notification de fin de mission parlait de « salarié ».
--    Corps identique a 20260723110000, seul le texte change.
-- ---------------------------------------------------------------------------
create or replace function private.finalize_mission_end(p_application_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v record;
begin
  select a.id, a.worker_id, a.mission_id, a.cv_status, s.owner_id, m.title,
         coalesce(nullif(trim(p.public_first_name), ''), nullif(split_part(trim(p.full_name), ' ', 1), ''), 'le participant') as worker_first_name
  into v
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  left join public.profiles p on p.id = a.worker_id
  where a.id = p_application_id
  for update of a;

  if not found or v.cv_status is not null then
    return; -- deja finalisee : ne rien refaire (idempotence).
  end if;

  update public.applications
  set conversation_status = 'closed',
      cv_status = 'pending_verification'
  where id = p_application_id;

  insert into public.rating_requests (application_id, mission_id, direction, reviewer_id)
  values
    (p_application_id, v.mission_id, 'worker_to_structure', v.worker_id),
    (p_application_id, v.mission_id, 'structure_to_worker', v.owner_id)
  on conflict (application_id, direction) do nothing;

  perform public.notify(
    v.worker_id, 'cv_updated', 'Mission ajoutée à ton parcours',
    '« ' || v.title || ' » a rejoint ton parcours (en cours de vérification).',
    jsonb_build_object('application_id', p_application_id, 'mission_id', v.mission_id)
  );

  perform public.notify(
    v.worker_id, 'rating_request', 'Mission terminée',
    'Comment s''est passée ta mission « ' || v.title || ' » ? Ton avis nous aide.',
    jsonb_build_object('application_id', p_application_id, 'direction', 'worker_to_structure')
  );
  perform public.notify(
    v.owner_id, 'rating_request', 'Mission terminée',
    'Comment s''est passée la mission « ' || v.title || ' » avec ' || v.worker_first_name || ' ? Donne ton avis.',
    jsonb_build_object('application_id', p_application_id, 'direction', 'structure_to_worker')
  );
end;
$$;
