-- Test du parcours Phase 0 (clic anonyme → déclaration → confirmation par la
-- structure → profil public), TOUJOURS ANNULE : applique les migrations
-- 20260926120000 et 20260928120000 dans une transaction, joue les règles sous
-- RLS puis lève une exception finale (rapport E2E_REPORT). Rien ne persiste.
do $test$
declare
  r jsonb := '{}'::jsonb;
  p_id uuid := gen_random_uuid(); s_id uuid := gen_random_uuid(); f_id uuid := gen_random_uuid();
  v_visitor uuid := gen_random_uuid();
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_a1 uuid; v_a2 uuid; v_token uuid; v_struct uuid; v_native uuid; v_app uuid;
  v_s1 text; v_s2 text; v_n int; v_json jsonb; v_read text;
begin
  execute $mig0$
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
-- 1. Missions importees depuis des plateformes partenaires.
--    Modele aligne sur la reponse GET /v0/mission de l'API Engagement
--    (schema MissionLegacy, doc officielle api/docs/openapi.yaml) :
--      _id            -> external_id (identifiant unique cote API Engagement)
--      clientId       -> client_id   (identifiant chez l'annonceur, unique
--                                     seulement par annonceur : jamais une cle)
--      publisherId    -> publisher_id / publisherName -> publisher_name
--      applicationUrl -> application_url : lien TRACKE par l'API Engagement
--                        (https://api.api-engagement.beta.gouv.fr/r/{id}/{diffuseur}),
--                        a utiliser tel quel pour que le clic soit compte.
-- ---------------------------------------------------------------------------
create table if not exists public.external_missions (
  id uuid primary key default gen_random_uuid(),
  source text not null check (length(source) between 2 and 60),
  external_id text not null check (length(external_id) between 1 and 200),
  client_id text,
  publisher_id text,
  publisher_name text,
  publisher_url text,
  publisher_logo_url text,
  mission_type text,
  domain text,
  activities text[] not null default '{}',
  status_code text,
  remote text,
  title text not null check (length(title) between 2 and 300),
  description text,
  organization_name text,
  organization_logo_url text,
  organization_url text,
  organization_rna text,
  organization_siren text,
  organization_status_juridique text,
  -- Priorite d'image : photo de mission (si licite) > illustration de la
  -- source > illustration UROSI de la categorie (cote client).
  image_url text,
  source_illustration_url text,
  category text not null default 'autre',
  city text,
  postal_code text,
  department_code text,
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
  source_created_at timestamptz,
  source_updated_at timestamptz,
  source_deleted_at timestamptz,
  last_seen_at timestamptz not null default now(),
  raw jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists external_missions_active_idx
  on public.external_missions (is_active, starts_at);
create index if not exists external_missions_client_idx
  on public.external_missions (source, publisher_id, client_id);

alter table public.external_missions enable row level security;

-- Lecture publique : c'est le catalogue visible avant meme l'inscription.
drop policy if exists "external_missions: public read active" on public.external_missions;
create policy "external_missions: public read active"
  on public.external_missions for select
  to anon, authenticated
  using (is_active);

-- Aucune policy d'ecriture : seul l'import (service_role) ecrit.
grant select on public.external_missions to anon, authenticated;

-- Journal des imports : date du dernier sync, volumes, erreurs. Lecture
-- reservee a l'equipe UROSI, ecriture par l'Edge Function (service_role).
create table if not exists public.external_import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  trigger text not null check (trigger in ('manual', 'cron')),
  triggered_by uuid references public.profiles (id) on delete set null,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'error', 'not_configured')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched integer not null default 0,
  imported integer not null default 0,
  skipped integer not null default 0,
  deactivated integer not null default 0,
  skip_reasons jsonb not null default '{}'::jsonb,
  error_message text
);

create index if not exists external_import_runs_recent_idx
  on public.external_import_runs (source, started_at desc);

alter table public.external_import_runs enable row level security;

drop policy if exists "external_import_runs: founder read" on public.external_import_runs;
create policy "external_import_runs: founder read"
  on public.external_import_runs for select
  to authenticated
  using (public.has_founder_access());

grant select on public.external_import_runs to authenticated;

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

-- ---------------------------------------------------------------------------
-- 5. Vue Centre Fondateur : missions importees, dernier sync, candidatures
--    externes commencees, erreurs d'import. Lecture seule, fondateur uniquement.
-- ---------------------------------------------------------------------------
create or replace function public.founder_external_missions_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_founder_access() then
    raise exception using errcode = '42501', message = 'Réservé à l''équipe UROSI.';
  end if;

  return jsonb_build_object(
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', s.source,
        'active', s.active,
        'inactive', s.inactive,
        'last_seen_at', s.last_seen_at
      ) order by s.source)
      from (
        select m.source,
               count(*) filter (where m.is_active) as active,
               count(*) filter (where not m.is_active) as inactive,
               max(m.last_seen_at) as last_seen_at
        from public.external_missions m
        group by m.source
      ) s
    ), '[]'::jsonb),
    'last_success', (
      select to_jsonb(r) from public.external_import_runs r
      where r.status in ('success', 'partial')
      order by r.started_at desc limit 1
    ),
    'runs', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.started_at desc)
      from (select * from public.external_import_runs order by started_at desc limit 20) r
    ), '[]'::jsonb),
    'applications', jsonb_build_object(
      'total', (select count(*) from public.external_applications),
      'last_7_days', (select count(*) from public.external_applications where clicked_at > now() - interval '7 days'),
      'by_status', coalesce((
        select jsonb_object_agg(status, n)
        from (select status, count(*) as n from public.external_applications group by status) x
      ), '{}'::jsonb)
    ),
    'recent_missions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'source', m.source, 'external_id', m.external_id, 'client_id', m.client_id,
        'publisher_name', m.publisher_name, 'title', m.title, 'organization_name', m.organization_name,
        'city', m.city, 'is_active', m.is_active, 'last_seen_at', m.last_seen_at,
        'applications', (select count(*) from public.external_applications ea where ea.external_mission_id = m.id)
      ) order by m.last_seen_at desc)
      from (select * from public.external_missions order by last_seen_at desc limit 50) m
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.founder_external_missions_overview() from public, anon;
grant execute on function public.founder_external_missions_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Mandat : jamais exige pour une mission solidaire.
--    Les policies restrictives du fichier 20260801190000_*.PENDING.sql
--    (appliquees en staging uniquement) exigeaient un mandat pour TOUTE
--    candidature et TOUTE publication. Elles sont remplacees par des
--    versions qui ne s'appliquent qu'aux missions remunerees (categorie
--    inactive en phase 0). La logique du mandat reste intacte pour la future
--    couche remuneree. En production, ou ces policies n'existent pas, cette
--    section les cree directement dans leur forme limitee.
-- ---------------------------------------------------------------------------
create or replace function public.mission_requires_mandat(p_mission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select not m.is_solidaire from public.missions m where m.id = p_mission_id), true);
$$;

revoke all on function public.mission_requires_mandat(uuid) from public, anon;
grant execute on function public.mission_requires_mandat(uuid) to authenticated;

drop policy if exists mandat_required_to_apply on public.applications;
create policy mandat_required_to_apply
  on public.applications
  as restrictive
  for insert
  to authenticated
  with check (not public.mission_requires_mandat(mission_id) or public.has_active_mandat());

drop policy if exists mandat_required_to_publish on public.missions;
create policy mandat_required_to_publish
  on public.missions
  as restrictive
  for insert
  to authenticated
  with check (is_solidaire or public.has_active_mandat());

-- ---------------------------------------------------------------------------
-- 7. Catalogue public des missions solidaires natives (/missions sans compte).
--    La table missions n'est pas lisible en anonyme (et contient des colonnes
--    financieres) : cette vue n'expose que des colonnes non sensibles, et
--    uniquement les missions solidaires ouvertes, a venir, publiees par une
--    structure verifiee, hors missions de test Fondateur.
-- ---------------------------------------------------------------------------
create or replace view public.public_solidarity_missions
with (security_barrier = true) as
select
  m.id, m.structure_id, m.title, m.detail, m.city, m.address, m.location, m.lat, m.lng,
  m.scheduled_date, m.start_time, m.end_time, m.duration_minutes, m.mission_category,
  m.places, m.positions,
  coalesce(nullif(s.trade_name, ''), s.name) as structure_name,
  s.logo_url as structure_logo_url,
  s.verification_status as structure_verification_status
from public.missions m
join public.structures s on s.id = m.structure_id
where m.status = 'open'
  and m.is_solidaire
  and m.archived_at is null
  and m.scheduled_date >= current_date
  and s.verification_status in ('verified', 'founder_bypass')
  and not public.is_founder_test_mission(m.structure_id);

revoke all on public.public_solidarity_missions from public;
grant select on public.public_solidarity_missions to anon, authenticated;

$mig0$;
  execute $mig2$
-- Phase 0 — parcours ultra simple : trouver → participer → prouver.
--
--   1. je vois une mission ;
--   2. je consulte sa fiche ;
--   3. je candidate chez l'annonceur (clic enregistré, JAMAIS bloqué par un
--      compte : user_id si connecté, sinon identifiant de visiteur anonyme) ;
--   4. après la date, je dis si j'y suis allé ;
--   5. la structure confirme → l'expérience vérifiée entre dans mon profil.
--
-- Strictement additif. Dépend de 20260926120000 (phase 0) et 20260927120000.
-- Une déclaration du participant n'est JAMAIS une vérification : seule la
-- réponse de la structure (lien de confirmation ou espace structure) rend une
-- expérience « verified_completed ».

-- ---------------------------------------------------------------------------
-- 1. Candidatures externes : clic anonyme possible, déclaration, confirmation.
-- ---------------------------------------------------------------------------
alter table public.external_applications alter column user_id drop not null;
alter table public.external_applications add column if not exists visitor_id uuid;
alter table public.external_applications add column if not exists organization_name text;
alter table public.external_applications add column if not exists mission_date date;
alter table public.external_applications add column if not exists participant_declared_completed boolean;
alter table public.external_applications add column if not exists participant_answered_at timestamptz;
alter table public.external_applications add column if not exists confirmation_token uuid;
alter table public.external_applications add column if not exists confirmation_requested_at timestamptz;
alter table public.external_applications add column if not exists structure_answer text;
alter table public.external_applications add column if not exists structure_answered_at timestamptz;

do $$
begin
  alter table public.external_applications drop constraint if exists external_applications_status_check;
  alter table public.external_applications add constraint external_applications_status_check
    check (status in (
      'external_application_started', -- clic « Candidater » (redirigé vers l'annonceur)
      'accepted_declared',             -- (ancien) acceptation déclarée
      'completed_declared',            -- « J'y suis allé » : en attente de confirmation
      'not_done_declared',             -- « Je n'y suis pas allé » : rien dans le profil
      'verified',                      -- (ancien) vérification par l'équipe UROSI
      'verified_completed',            -- la structure a confirmé la participation
      'not_confirmed',                 -- la structure n'a pas confirmé
      'withdrawn'
    ));
  if not exists (select 1 from pg_constraint where conname = 'external_applications_owner_check') then
    alter table public.external_applications add constraint external_applications_owner_check
      check (user_id is not null or visitor_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'external_applications_structure_answer_check') then
    alter table public.external_applications add constraint external_applications_structure_answer_check
      check (structure_answer is null or structure_answer in ('confirmed', 'denied'));
  end if;
end;
$$;

create unique index if not exists external_applications_visitor_unique
  on public.external_applications (visitor_id, external_mission_id)
  where user_id is null and visitor_id is not null;
create unique index if not exists external_applications_token_unique
  on public.external_applications (confirmation_token)
  where confirmation_token is not null;

-- Le participant n'écrit plus directement : clic, déclaration et
-- rattachement passent par les fonctions ci-dessous. Garde : rien de
-- sensible n'est modifiable hors de ces fonctions (drapeau de transaction
-- posé uniquement par elles) ou par l'équipe UROSI.
create or replace function public.guard_external_application_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean :=
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or public.has_founder_access()
    or coalesce(current_setting('urosi.journey_write', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.clicked_at := now();
    new.status_updated_at := now();
    if not v_trusted then
      new.status := 'external_application_started';
      new.verified_at := null;
      new.verified_by := null;
      new.verification_note := null;
      new.participant_declared_completed := null;
      new.confirmation_token := null;
      new.structure_answer := null;
    end if;
    return new;
  end if;

  if not v_trusted then
    raise exception using errcode = '42501', message = 'Candidature externe non modifiable directement.';
  end if;

  if new.external_mission_id is distinct from old.external_mission_id
     or new.clicked_at is distinct from old.clicked_at
     or (old.user_id is not null and new.user_id is distinct from old.user_id) then
    raise exception using errcode = '42501', message = 'Candidature externe non modifiable.';
  end if;

  if new.status is distinct from old.status then
    new.status_updated_at := now();
  end if;
  return new;
end;
$$;

-- Lecture : ses propres clics (connecté). Un visiteur anonyme ne relit rien
-- côté serveur (son appareil garde sa liste).
drop policy if exists "external_applications: own insert" on public.external_applications;
drop policy if exists "external_applications: own update" on public.external_applications;
revoke insert, update on public.external_applications from authenticated;

create or replace function public.journey_mission_date(p_starts_at timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (p_starts_at at time zone 'Europe/Paris')::date;
$$;

-- Comportement 3 : « Candidater ↗ ». Enregistre le clic (jamais bloquant
-- côté interface) : user_id si connecté, sinon identifiant de visiteur.
create or replace function public.record_application_click(p_external_mission_id uuid, p_visitor_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_mission public.external_missions%rowtype;
  v_id uuid;
begin
  if v_user is null and p_visitor_id is null then
    raise exception 'Identifiant de visiteur requis.';
  end if;
  select * into v_mission from public.external_missions where id = p_external_mission_id;
  if not found then
    raise exception 'Mission introuvable.';
  end if;
  perform set_config('urosi.journey_write', 'on', true);

  if v_user is not null then
    select id into v_id from public.external_applications
    where user_id = v_user and external_mission_id = p_external_mission_id;
  else
    select id into v_id from public.external_applications
    where user_id is null and visitor_id = p_visitor_id and external_mission_id = p_external_mission_id;
  end if;

  if v_id is null then
    insert into public.external_applications (user_id, visitor_id, external_mission_id, source, status, organization_name, mission_date)
    values (v_user, p_visitor_id, p_external_mission_id, v_mission.source, 'external_application_started',
            v_mission.organization_name, public.journey_mission_date(v_mission.starts_at))
    returning id into v_id;
  end if;
  perform set_config('urosi.journey_write', 'off', true);
  return v_id;
end;
$$;

revoke all on function public.record_application_click(uuid, uuid) from public;
grant execute on function public.record_application_click(uuid, uuid) to anon, authenticated;

-- Après création du profil ou connexion : les clics faits en visiteur
-- rejoignent le compte (sauf mission déjà suivie par ce compte).
create or replace function public.claim_visitor_clicks(p_visitor_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null or p_visitor_id is null then
    return 0;
  end if;
  perform set_config('urosi.journey_write', 'on', true);
  update public.external_applications a
  set user_id = v_user
  where a.user_id is null
    and a.visitor_id = p_visitor_id
    and not exists (
      select 1 from public.external_applications b
      where b.user_id = v_user and b.external_mission_id = a.external_mission_id
    );
  get diagnostics v_count = row_count;
  perform set_config('urosi.journey_write', 'off', true);
  return v_count;
end;
$$;

revoke all on function public.claim_visitor_clicks(uuid) from public, anon;
grant execute on function public.claim_visitor_clicks(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Missions natives : déclaration du participant.
-- ---------------------------------------------------------------------------
alter table public.applications add column if not exists participant_declared_completed boolean;
alter table public.applications add column if not exists participant_answered_at timestamptz;

-- Comportement 4 : « Alors, ta mission ? » — J'y suis allé / Je n'y suis pas
-- allé. p_kind = 'external' (id de mission importée) ou 'urosi' (id de mission
-- native). Aucune vérification ici : « J'y suis allé » crée seulement une
-- demande de confirmation adressée à la structure.
create or replace function public.declare_participation(p_kind text, p_mission_id uuid, p_went boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_ext public.external_applications%rowtype;
  v_app record;
  v_name text;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Connexion requise.';
  end if;

  if p_kind = 'external' then
    select * into v_ext from public.external_applications
    where user_id = v_user and external_mission_id = p_mission_id
    for update;
    if not found then
      raise exception 'Candidature introuvable.';
    end if;
    if v_ext.status not in ('external_application_started', 'accepted_declared', 'completed_declared', 'not_done_declared') then
      return v_ext.status; -- déjà traitée par la structure : rien ne change
    end if;
    if coalesce(v_ext.mission_date, (v_ext.clicked_at at time zone 'Europe/Paris')::date + 7) > current_date then
      raise exception 'La mission n''a pas encore eu lieu.';
    end if;
    perform set_config('urosi.journey_write', 'on', true);
    update public.external_applications
    set participant_declared_completed = p_went,
        participant_answered_at = now(),
        status = case when p_went then 'completed_declared' else 'not_done_declared' end,
        completed_declared_at = case when p_went then coalesce(completed_declared_at, now()) else completed_declared_at end,
        confirmation_token = case when p_went then coalesce(confirmation_token, gen_random_uuid()) else confirmation_token end,
        confirmation_requested_at = case when p_went then coalesce(confirmation_requested_at, now()) else confirmation_requested_at end
    where id = v_ext.id;
    perform set_config('urosi.journey_write', 'off', true);
    return case when p_went then 'completed_declared' else 'not_done_declared' end;
  end if;

  if p_kind = 'urosi' then
    select a.id, a.status, m.title, m.scheduled_date, s.owner_id
    into v_app
    from public.applications a
    join public.missions m on m.id = a.mission_id
    join public.structures s on s.id = m.structure_id
    where a.worker_id = v_user and a.mission_id = p_mission_id and a.status not in ('cancelled', 'rejected')
    order by a.created_at desc
    limit 1
    for update of a;
    if not found then
      raise exception 'Candidature introuvable.';
    end if;
    if v_app.scheduled_date > current_date then
      raise exception 'La mission n''a pas encore eu lieu.';
    end if;
    update public.applications
    set participant_declared_completed = p_went, participant_answered_at = now()
    where id = v_app.id;
    if p_went then
      select coalesce(nullif(trim(p.public_first_name), ''), nullif(split_part(trim(p.full_name), ' ', 1), ''), 'Un bénévole')
      into v_name from public.profiles p where p.id = v_user;
      perform public.notify(
        v_app.owner_id, 'participation_declared', 'Participation à confirmer',
        v_name || ' indique avoir réalisé la mission « ' || v_app.title || ' » le '
          || to_char(v_app.scheduled_date, 'DD/MM/YYYY') || '. Pouvez-vous confirmer sa participation ?',
        jsonb_build_object('application_id', v_app.id, 'mission_id', p_mission_id)
      );
    end if;
    return case when p_went then 'completed_declared' else 'not_done_declared' end;
  end if;

  raise exception 'Type de mission inconnu.';
end;
$$;

revoke all on function public.declare_participation(text, uuid, boolean) from public, anon;
grant execute on function public.declare_participation(text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Comportement 5 (mission externe) : la structure confirme via un lien
--    unique, sans compte. Le lien n'expose que le prénom + initiale.
-- ---------------------------------------------------------------------------
create or replace function public.journey_display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select trim(concat_ws(' ',
    coalesce(nullif(trim(p.public_first_name), ''), nullif(split_part(trim(p.full_name), ' ', 1), ''), 'Bénévole'),
    case
      when array_length(regexp_split_to_array(trim(coalesce(p.full_name, '')), '\s+'), 1) > 1
        then upper(left((regexp_split_to_array(trim(p.full_name), '\s+'))[array_length(regexp_split_to_array(trim(p.full_name), '\s+'), 1)], 1)) || '.'
    end))
  from public.profiles p where p.id = p_user_id;
$$;

revoke all on function public.journey_display_name(uuid) from public, anon, authenticated;

create or replace function public.get_participation_request(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'participant', public.journey_display_name(a.user_id),
    'mission_title', m.title,
    'organization_name', coalesce(a.organization_name, m.organization_name),
    'mission_date', coalesce(a.mission_date, (a.completed_declared_at at time zone 'Europe/Paris')::date),
    'city', m.city,
    'answer', a.structure_answer
  )
  from public.external_applications a
  join public.external_missions m on m.id = a.external_mission_id
  where a.confirmation_token = p_token and a.user_id is not null;
$$;

create or replace function public.answer_participation_request(p_token uuid, p_confirmed boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.external_applications%rowtype;
begin
  select * into v_row from public.external_applications where confirmation_token = p_token for update;
  if not found then
    raise exception 'Lien de confirmation invalide.';
  end if;
  if v_row.structure_answer is not null then
    return v_row.structure_answer; -- réponse unique, jamais modifiable par le lien
  end if;
  if v_row.status <> 'completed_declared' then
    raise exception 'Aucune participation à confirmer.';
  end if;
  perform set_config('urosi.journey_write', 'on', true);
  update public.external_applications
  set structure_answer = case when p_confirmed then 'confirmed' else 'denied' end,
      structure_answered_at = now(),
      status = case when p_confirmed then 'verified_completed' else 'not_confirmed' end,
      verified_at = case when p_confirmed then now() else null end,
      verification_note = 'Réponse de la structure via le lien de confirmation'
  where id = v_row.id;
  perform set_config('urosi.journey_write', 'off', true);
  if p_confirmed then
    perform public.notify(v_row.user_id, 'participation_confirmed', 'Participation confirmée',
      'La structure a confirmé ta participation : l''expérience rejoint ton profil.',
      jsonb_build_object('external_application_id', v_row.id));
  end if;
  return case when p_confirmed then 'confirmed' else 'denied' end;
end;
$$;

revoke all on function public.get_participation_request(uuid) from public;
revoke all on function public.answer_participation_request(uuid, boolean) from public;
grant execute on function public.get_participation_request(uuid) to anon, authenticated;
grant execute on function public.answer_participation_request(uuid, boolean) to anon, authenticated;

-- Centre Fondateur : participations déclarées en attente de la structure,
-- avec le lien à lui transmettre (aucun envoi automatique d'email configuré).
create or replace function public.founder_pending_participations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_founder_access() then
    raise exception using errcode = '42501', message = 'Réservé à l''équipe UROSI.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id,
      'participant', public.journey_display_name(a.user_id),
      'mission_title', m.title,
      'organization_name', coalesce(a.organization_name, m.organization_name),
      'organization_url', m.organization_url,
      'mission_date', a.mission_date,
      'declared_at', a.participant_answered_at,
      'token', a.confirmation_token
    ) order by a.participant_answered_at)
    from public.external_applications a
    join public.external_missions m on m.id = a.external_mission_id
    where a.status = 'completed_declared' and a.structure_answer is null and a.confirmation_token is not null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.founder_pending_participations() from public, anon;
grant execute on function public.founder_pending_participations() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Profil public : visible seulement si la personne l'a choisi, et
--    uniquement les expériences confirmées par une structure.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists public_profile boolean not null default false;

create or replace function public.public_participant_profile(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id, p.city, p.avatar_url from public.profiles p
    where p.id = p_user_id and p.public_profile
  ),
  xp as (
    select m.title, coalesce(a.organization_name, m.organization_name, 'Association') as organization,
           coalesce(a.mission_date, (a.verified_at at time zone 'Europe/Paris')::date) as day,
           coalesce(a.declared_minutes, m.duration_minutes) as minutes
    from public.external_applications a
    join public.external_missions m on m.id = a.external_mission_id
    where a.user_id = p_user_id and a.status in ('verified_completed', 'verified')
    union all
    select m.title, coalesce(nullif(s.trade_name, ''), s.name), m.scheduled_date,
           coalesce(m.duration_minutes, 0)
    from public.applications ap
    join public.missions m on m.id = ap.mission_id
    join public.structures s on s.id = m.structure_id
    where ap.worker_id = p_user_id and ap.cv_status = 'verified'
  )
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'name', public.journey_display_name(p_user_id),
    'city', (select city from me),
    'avatar_url', (select avatar_url from me),
    'missions', (select count(*) from xp),
    'minutes', (select coalesce(sum(minutes), 0) from xp),
    'experiences', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'organization', organization, 'day', day, 'minutes', minutes) order by day desc nulls last) from xp), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.public_participant_profile(uuid) from public;
grant execute on function public.public_participant_profile(uuid) to anon, authenticated;

$mig2$;
  r := r || jsonb_build_object('00_migrations', true);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', 'journey-lea@urosi.internal', '', now(), '{"provider":"email"}', '{"full_name":"Léa Martin","role":"worker","city":"Lille"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', s_id, 'authenticated', 'authenticated', 'journey-asso@urosi.internal', '', now(), '{"provider":"email"}', '{"full_name":"Asso Journey","role":"structure_admin"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', f_id, 'authenticated', 'authenticated', 'journey-founder@urosi.internal', '', now(), '{"provider":"email","is_founder":true}', '{"full_name":"Fondateur","role":"worker"}', now(), now());

  insert into public.external_missions (source, external_id, title, organization_name, city, starts_at, duration_minutes, application_url)
  values ('api_engagement', 'journey-1', 'Distribution alimentaire', 'Banque Alimentaire de Lille', 'Lille', now() + interval '3 days', 180, 'https://api.api-engagement.beta.gouv.fr/r/journey-1/pub')
  returning id into v_m1;
  insert into public.external_missions (source, external_id, title, organization_name, city, starts_at, duration_minutes, application_url)
  values ('api_engagement', 'journey-2', 'Festival solidaire', 'Association X', 'Lille', now() - interval '5 days', 240, 'https://api.api-engagement.beta.gouv.fr/r/journey-2/pub')
  returning id into v_m2;
  insert into public.external_missions (source, external_id, title, organization_name, city, starts_at, duration_minutes, application_url)
  values ('api_engagement', 'journey-3', 'Collecte vêtements', 'Association Y', 'Roubaix', now() - interval '2 days', 120, 'https://api.api-engagement.beta.gouv.fr/r/journey-3/pub')
  returning id into v_m3;

  -- 01-02 : clic anonyme (visiteur), idempotent, illisible par un anonyme
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    set local role anon;
    v_a1 := public.record_application_click(v_m1, v_visitor);
    v_a2 := public.record_application_click(v_m1, v_visitor);
    perform public.record_application_click(v_m2, v_visitor);
    begin
      select count(*)::text into v_read from public.external_applications;
    exception when others then v_read := 'refusé: ' || sqlerrm;
    end;
    reset role;
    r := r || jsonb_build_object('01_clic_anonyme_sans_compte', v_a1 is not null and v_a1 = v_a2, '02_anonyme_ne_relit_rien', v_read);
  exception when others then reset role; r := r || jsonb_build_object('01_clic_anonyme_sans_compte', 'ERREUR: ' || sqlerrm);
  end;
  r := r || jsonb_build_object('03_clic_contient_structure_date_source', (select jsonb_build_object('org', organization_name, 'date', mission_date, 'source', source, 'user', user_id) from public.external_applications where id = v_a1));
  begin
    set local role anon;
    perform public.declare_participation('external', v_m2, true);
    reset role;
    r := r || jsonb_build_object('04_anonyme_ne_peut_pas_declarer', false);
  exception when others then reset role; r := r || jsonb_build_object('04_anonyme_ne_peut_pas_declarer', 'oui: ' || sqlerrm);
  end;

  -- 05 : le participant crée son profil → ses clics de visiteur le rejoignent
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    v_n := public.claim_visitor_clicks(v_visitor);
    perform public.record_application_click(v_m3, null);
    reset role;
    r := r || jsonb_build_object('05_clics_rattaches_au_compte', v_n = 2);
  exception when others then reset role; r := r || jsonb_build_object('05_clics_rattaches_au_compte', 'ERREUR: ' || sqlerrm);
  end;

  -- 06 : écriture directe interdite (ni statut, ni vérification)
  begin
    set local role authenticated;
    update public.external_applications set status = 'verified_completed' where id = v_a1;
    reset role;
    r := r || jsonb_build_object('06_ecriture_directe_refusee', false);
  exception when others then reset role; r := r || jsonb_build_object('06_ecriture_directe_refusee', 'oui: ' || sqlerrm);
  end;

  -- 07 : pas de déclaration avant la date de la mission
  begin
    set local role authenticated;
    perform public.declare_participation('external', v_m1, true);
    reset role;
    r := r || jsonb_build_object('07_pas_avant_la_date', false);
  exception when others then reset role; r := r || jsonb_build_object('07_pas_avant_la_date', 'oui: ' || sqlerrm);
  end;

  -- 08 : « J'y suis allé » → en attente, jamais vérifié ; « Je n'y suis pas allé » → rien
  begin
    set local role authenticated;
    v_s1 := public.declare_participation('external', v_m2, true);
    v_s2 := public.declare_participation('external', v_m3, false);
    reset role;
    r := r || jsonb_build_object('08_declarations', jsonb_build_array(v_s1, v_s2),
      '08b_demande_de_confirmation_creee', (select confirmation_token is not null and participant_declared_completed and status = 'completed_declared' from public.external_applications where user_id = p_id and external_mission_id = v_m2),
      '08c_non_alle_sans_lien', (select confirmation_token is null and status = 'not_done_declared' from public.external_applications where user_id = p_id and external_mission_id = v_m3));
  exception when others then reset role; r := r || jsonb_build_object('08_declarations', 'ERREUR: ' || sqlerrm);
  end;
  select confirmation_token into v_token from public.external_applications where user_id = p_id and external_mission_id = v_m2;

  -- 09 : profil public désactivé par défaut ; déclaration non visible publiquement
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    set local role anon;
    v_json := public.public_participant_profile(p_id);
    reset role;
    r := r || jsonb_build_object('09_profil_prive_par_defaut', v_json is null);
  exception when others then reset role; r := r || jsonb_build_object('09_profil_prive_par_defaut', 'ERREUR: ' || sqlerrm);
  end;

  -- 10 : la structure ouvre le lien (sans compte) et confirme
  begin
    set local role anon;
    v_json := public.get_participation_request(v_token);
    v_s1 := public.answer_participation_request(v_token, true);
    v_s2 := public.answer_participation_request(v_token, false);
    reset role;
    r := r || jsonb_build_object('10_demande_vue_par_la_structure', v_json, '10b_reponse', v_s1, '10c_reponse_unique', v_s2,
      '10d_statut', (select status from public.external_applications where confirmation_token = v_token));
  exception when others then reset role; r := r || jsonb_build_object('10_demande_vue_par_la_structure', 'ERREUR: ' || sqlerrm);
  end;
  begin
    set local role anon;
    perform public.answer_participation_request(gen_random_uuid(), true);
    reset role;
    r := r || jsonb_build_object('11_lien_invalide_refuse', false);
  exception when others then reset role; r := r || jsonb_build_object('11_lien_invalide_refuse', 'oui: ' || sqlerrm);
  end;

  -- 12 : le participant rend son profil public → seule l'expérience confirmée apparaît
  update public.profiles set public_profile = true where id = p_id;
  begin
    set local role anon;
    v_json := public.public_participant_profile(p_id);
    reset role;
    r := r || jsonb_build_object('12_profil_public', v_json);
  exception when others then reset role; r := r || jsonb_build_object('12_profil_public', 'ERREUR: ' || sqlerrm);
  end;

  -- 13 : mission native passée, candidature acceptée → déclaration + notification structure
  insert into public.structures (owner_id, name, siret, verification_status, is_association) values (s_id, 'Asso Journey', '12345678900012', 'verified', true) returning id into v_struct;
  insert into public.missions (structure_id, title, city, address, location, scheduled_date, start_time, end_time, duration_minutes, slots, places, positions, worker_rate_cents, worker_amount, mission_category, is_solidaire, no_salaried_substitution, status)
  values (v_struct, 'Tri de dons (journey)', 'Lille', '1 rue Test', '1 rue Test', current_date - 1, '09:00', '12:00', 180, jsonb_build_array(jsonb_build_object('date', (current_date - 1)::text, 'start', '09:00', 'end', '12:00')), 1, 1, 0, 0, 'solidarite', true, true, 'open')
  returning id into v_native;
  insert into public.applications (mission_id, worker_id) values (v_native, p_id) returning id into v_app;
  update public.applications set status = 'accepted' where id = v_app;
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    v_s1 := public.declare_participation('urosi', v_native, true);
    reset role;
    r := r || jsonb_build_object('13_mission_native_declaree', v_s1,
      '13b_structure_notifiee', (select body from public.notifications where profile_id = s_id and kind = 'participation_declared' order by created_at desc limit 1),
      '13c_pas_verifiee', (select coalesce(cv_status, 'aucun') from public.applications where id = v_app));
  exception when others then reset role; r := r || jsonb_build_object('13_mission_native_declaree', 'ERREUR: ' || sqlerrm);
  end;

  -- 14 : Centre Fondateur : participations à transmettre (une nouvelle déclaration)
  perform set_config('urosi.journey_write', 'on', true);
  update public.external_applications set mission_date = current_date - 1 where user_id = p_id and external_mission_id = v_m1;
  perform set_config('urosi.journey_write', 'off', true);
  begin
    set local role authenticated;
    perform public.declare_participation('external', v_m1, true);
    reset role;
  exception when others then reset role; r := r || jsonb_build_object('14_prep', 'ERREUR: ' || sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', f_id, 'role', 'authenticated', 'app_metadata', json_build_object('is_founder', true))::text, true);
  begin
    set local role authenticated;
    v_json := public.founder_pending_participations();
    reset role;
    r := r || jsonb_build_object('14_fondateur_participations_a_confirmer', (select jsonb_agg(jsonb_build_object('who', x ->> 'participant', 'mission', x ->> 'mission_title', 'token', (x ->> 'token') is not null)) from jsonb_array_elements(v_json) x));
  exception when others then reset role; r := r || jsonb_build_object('14_fondateur_participations_a_confirmer', 'ERREUR: ' || sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    v_json := public.founder_pending_participations();
    reset role;
    r := r || jsonb_build_object('15_liste_reservee_fondateur', false);
  exception when others then reset role; r := r || jsonb_build_object('15_liste_reservee_fondateur', 'oui: ' || sqlerrm);
  end;

  raise exception 'E2E_REPORT %', jsonb_pretty(r);
end;
$test$;
