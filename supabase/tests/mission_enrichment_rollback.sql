-- Test de la migration d'enrichissement (images, provenance, agent), TOUJOURS
-- ANNULE : le bloc applique les migrations 20260926120000 et 20260927120000,
-- cree des comptes de test @urosi.internal, joue les regles sous RLS puis leve
-- volontairement une exception finale : rien ne persiste. Le rapport est dans
-- le message d'erreur E2E_REPORT. A regenerer si l'une des migrations change.
do $test$
declare
  r jsonb := '{}'::jsonb;
  s_id uuid := gen_random_uuid();
  o_id uuid := gen_random_uuid();
  f_id uuid := gen_random_uuid();
  v_struct uuid; v_mission uuid; v_ext uuid; v_ext2 uuid; v_img1 uuid; v_img2 uuid; v_img3 uuid;
  v_n int; v_json jsonb; v_base text; v_path text; v_arr text[];
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
  execute $mig1$
-- Couche permanente d'enrichissement des missions : images, provenance,
-- sources autorisees, agent de decouverte (toutes les 3 heures).
--
-- Strictement additif, comme la migration phase 0 dont elle depend
-- (20260926120000_phase0_solidarity_missions.sql). Aucune donnee n'est
-- supprimee : une mission externe qui disparait de sa source est DESACTIVEE
-- (is_active = false + motif), jamais effacee.
--
-- Hierarchie des visuels d'une mission (appliquee a l'affichage) :
--   1. photo native fournie par la structure UROSI (mission_images) ;
--   2. image de mission explicitement fournie par une source partenaire et
--      reutilisable (mission_images, droits connus) ;
--   3. logo de l'organisation (organizationLogo) — affiche comme un LOGO,
--      jamais comme une photo de mission ;
--   4. logo du domaine d'action (domainLogo) ;
--   5. illustration UROSI de la categorie (cote client, propriete UROSI).
-- Une image dont les droits sont inconnus (rights_status = 'unknown') n'est
-- jamais publiee automatiquement.

-- ---------------------------------------------------------------------------
-- 1. Registre des sources autorisees.
--    L'agent n'interroge QUE les sources `enabled`. Une source ne peut etre
--    activee que si son acces automatise est autorise, que la base legale de
--    reutilisation est ecrite noir sur blanc et que quelqu'un l'a verifiee.
--    Aucun contournement de protection anti-bot : une source qui en oppose
--    une est suspendue par l'agent (voir _shared/missionAgent).
-- ---------------------------------------------------------------------------
create table if not exists public.mission_sources (
  id text primary key check (id ~ '^[a-z0-9_]{2,60}$'),
  name text not null check (length(name) between 2 and 120),
  source_type text not null
    check (source_type in ('api', 'open_data', 'rss', 'xml', 'json', 'authorized_page')),
  -- Nom de l'adaptateur de code qui lit cette source (_shared/missionAgent/sources).
  adapter text not null,
  base_url text not null check (base_url ~* '^https://'),
  documentation_url text check (documentation_url is null or documentation_url ~* '^https://'),
  terms_url text check (terms_url is null or terms_url ~* '^https://'),
  -- Pourquoi UROSI a le droit de lire et d'afficher ces donnees
  -- (convention, licence ouverte, accord ecrit...).
  reuse_basis text,
  license text,
  automated_access_allowed boolean not null default false,
  -- La source fournit-elle des photos de mission reutilisables ?
  mission_images_reusable boolean not null default false,
  -- La source fournit-elle des logos (organisation, domaine) diffusables ?
  logos_reusable boolean not null default false,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  verified_by uuid references public.profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mission_sources_enabled_requires_authorization check (
    not enabled
    or (automated_access_allowed and nullif(trim(coalesce(reuse_basis, '')), '') is not null and verified_at is not null)
  )
);

alter table public.mission_sources enable row level security;

drop policy if exists "mission_sources: founder read" on public.mission_sources;
create policy "mission_sources: founder read"
  on public.mission_sources for select
  to authenticated
  using (public.has_founder_access());

grant select on public.mission_sources to authenticated;
-- Ecriture : SQL / service_role uniquement (ajout d'une source = decision
-- explicite, documentee dans docs/mission-agent.md).

-- API Engagement : API publique de l'Etat, acces diffuseur par cle
-- nominative. Le format v0 (GET /v0/mission) fournit organizationLogo,
-- domainLogo et publisherLogo mais AUCUNE photo de mission : verifie dans
-- api/src/v0/mission/constants.ts (MISSION_FIELDS) du depot officiel.
insert into public.mission_sources (
  id, name, source_type, adapter, base_url, documentation_url, reuse_basis,
  automated_access_allowed, mission_images_reusable, logos_reusable, enabled,
  config, verified_at, notes
) values (
  'api_engagement',
  'API Engagement',
  'api',
  'api_engagement_v0',
  'https://api.api-engagement.beta.gouv.fr',
  'https://github.com/betagouv/api-engagement',
  'API publique de l''Etat (beta.gouv.fr) destinee aux diffuseurs de missions d''engagement : acces par cle diffuseur nominative, diffusion des missions et des logos prevue par l''API, liens de candidature traces.',
  true,
  false,
  true,
  true,
  jsonb_build_object('lat', 50.6292, 'lon', 3.0573, 'distance_km', 25, 'types', jsonb_build_array('benevolat'), 'max_missions', 2000),
  now(),
  'Sans secret API_ENGAGEMENT_KEY, chaque execution est journalisee « non configuree » et ne modifie rien.'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Provenance des missions externes.
-- ---------------------------------------------------------------------------
alter table public.external_missions add column if not exists source_type text;
alter table public.external_missions add column if not exists source_name text;
alter table public.external_missions add column if not exists last_checked_at timestamptz;
alter table public.external_missions add column if not exists last_changed_at timestamptz;
-- Niveau de visuel retenu pour la mission (hierarchie ci-dessus) et droits
-- associes (null = illustration UROSI, propriete d'UROSI).
alter table public.external_missions add column if not exists image_source text;
alter table public.external_missions add column if not exists image_rights_status text;
alter table public.external_missions add column if not exists domain_logo_url text;
alter table public.external_missions add column if not exists content_hash text;
alter table public.external_missions add column if not exists dedupe_key text;
alter table public.external_missions add column if not exists duplicate_of_external uuid
  references public.external_missions (id) on delete set null;
alter table public.external_missions add column if not exists duplicate_of_mission uuid
  references public.missions (id) on delete set null;
alter table public.external_missions add column if not exists deactivated_at timestamptz;
alter table public.external_missions add column if not exists deactivation_reason text;

comment on column public.external_missions.source is
  'Identifiant de la source (public.mission_sources.id).';
comment on column public.external_missions.source_url is
  'Adresse exacte de la fiche dans la source (ex. GET /v0/mission/{_id} pour l''API Engagement).';
comment on column public.external_missions.image_url is
  'Photo de mission fournie par la source et reutilisable (niveau 2). Jamais un logo.';
comment on column public.external_missions.source_illustration_url is
  'Obsolete : remplace par domain_logo_url (conserve pour compatibilite).';

-- Anciennes lignes (import phase 0) : provenance deduite, logo de domaine
-- repris de l'ancienne colonne.
update public.external_missions
set source_type = coalesce(source_type, 'api'),
    source_name = coalesce(source_name, 'API Engagement'),
    domain_logo_url = coalesce(domain_logo_url, source_illustration_url),
    last_checked_at = coalesce(last_checked_at, last_seen_at),
    last_changed_at = coalesce(last_changed_at, updated_at)
where source = 'api_engagement';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'external_missions_source_fk') then
    alter table public.external_missions
      add constraint external_missions_source_fk
      foreign key (source) references public.mission_sources (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'external_missions_source_type_check') then
    alter table public.external_missions
      add constraint external_missions_source_type_check
      check (source_type is null or source_type in ('api', 'open_data', 'rss', 'xml', 'json', 'authorized_page'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'external_missions_image_source_check') then
    alter table public.external_missions
      add constraint external_missions_image_source_check
      check (image_source is null or image_source in (
        'partner_mission_image', 'authorized_image', 'organization_logo', 'domain_logo', 'urosi_illustration'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'external_missions_image_rights_check') then
    alter table public.external_missions
      add constraint external_missions_image_rights_check
      check (image_rights_status is null or image_rights_status in ('source_provided', 'licensed', 'authorized', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'external_missions_deactivation_reason_check') then
    alter table public.external_missions
      add constraint external_missions_deactivation_reason_check
      check (deactivation_reason is null or deactivation_reason in (
        'removed_at_source', 'deleted_at_source', 'expired', 'status_changed', 'excluded', 'source_disabled'
      ));
  end if;
end;
$$;

create index if not exists external_missions_dedupe_idx
  on public.external_missions (dedupe_key) where is_active;

-- Cle de dedoublonnage : titre + structure + lieu + date, normalises
-- (casse, accents, ponctuation). Meme fonction pour missions natives et
-- externes.
create or replace function public.normalize_dedupe_text(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(trim(regexp_replace(
    translate(
      replace(replace(lower(coalesce(p_value, '')), 'œ', 'oe'), 'æ', 'ae'),
      'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ',
      'aaaaaaceeeeiiiinooooouuuuyy'
    ),
    '[^a-z0-9]+', ' ', 'g'
  )), '');
$$;

create or replace function public.mission_dedupe_key(p_title text, p_organization text, p_city text, p_day date)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when public.normalize_dedupe_text(p_title) is null then null
    else concat_ws('|',
      public.normalize_dedupe_text(p_title),
      coalesce(public.normalize_dedupe_text(p_organization), ''),
      coalesce(public.normalize_dedupe_text(p_city), ''),
      coalesce(p_day::text, ''))
  end;
$$;

create or replace function public.external_missions_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.dedupe_key := public.mission_dedupe_key(
    new.title, new.organization_name, new.city,
    (new.starts_at at time zone 'Europe/Paris')::date
  );
  if new.is_active then
    new.deactivated_at := null;
    new.deactivation_reason := null;
  elsif tg_op = 'INSERT' or old.is_active then
    new.deactivated_at := coalesce(new.deactivated_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_external_missions_before_write on public.external_missions;
create trigger trg_external_missions_before_write
  before insert or update on public.external_missions
  for each row execute function public.external_missions_before_write();

-- Recalcule la cle des lignes existantes.
update public.external_missions set title = title where dedupe_key is null;

-- Catalogue public : une mission marquee doublon n'apparait qu'une fois.
drop policy if exists "external_missions: public read active" on public.external_missions;
create policy "external_missions: public read active"
  on public.external_missions for select
  to anon, authenticated
  using (is_active and duplicate_of_external is null and duplicate_of_mission is null);

drop policy if exists "external_missions: founder read" on public.external_missions;
create policy "external_missions: founder read"
  on public.external_missions for select
  to authenticated
  using (public.has_founder_access());

-- ---------------------------------------------------------------------------
-- 3. Images de mission (natives ET externes), avec provenance et droits.
-- ---------------------------------------------------------------------------
create table if not exists public.mission_images (
  id uuid primary key default gen_random_uuid(),
  -- Mission native UROSI...
  mission_id uuid references public.missions (id) on delete cascade,
  -- ...ou mission importee (image trouvee par l'agent).
  external_mission_id uuid references public.external_missions (id) on delete cascade,
  image_url text not null check (image_url ~* '^https://'),
  -- Chemin dans le bucket mission-images (photos televersees par une structure).
  storage_path text,
  source text not null
    check (source in ('structure_upload', 'partner_feed', 'authorized_source')),
  -- Page ou fichier d'origine de l'image (provenance exacte).
  source_url text,
  rights_status text not null
    check (rights_status in ('source_provided', 'licensed', 'authorized', 'unknown')),
  rights_note text,
  license text,
  attribution text,
  rights_attested_by uuid references public.profiles (id) on delete set null,
  rights_attested_at timestamptz,
  is_primary boolean not null default false,
  position smallint not null default 0 check (position between 0 and 5),
  alt_text text check (alt_text is null or length(alt_text) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mission_images_one_target check (num_nonnulls(mission_id, external_mission_id) = 1),
  -- Une photo televersee par une structure : droits attestes par elle.
  constraint mission_images_upload_attested check (
    source <> 'structure_upload'
    or (mission_id is not null and rights_status = 'authorized' and rights_attested_by is not null and storage_path is not null)
  ),
  -- Une image aux droits inconnus n'est jamais image principale.
  constraint mission_images_unknown_not_primary check (rights_status <> 'unknown' or not is_primary)
);

create unique index if not exists mission_images_one_primary_native
  on public.mission_images (mission_id) where is_primary and mission_id is not null;
create unique index if not exists mission_images_one_primary_external
  on public.mission_images (external_mission_id) where is_primary and external_mission_id is not null;
create unique index if not exists mission_images_external_url_unique
  on public.mission_images (external_mission_id, image_url) where external_mission_id is not null;
create index if not exists mission_images_mission_idx on public.mission_images (mission_id, position);

-- 1 image principale + 5 facultatives au maximum par mission native.
create or replace function public.mission_images_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    if new.mission_id is not null then
      perform 1 from public.missions m where m.id = new.mission_id for update;
      if (select count(*) from public.mission_images i where i.mission_id = new.mission_id) >= 6 then
        raise exception using errcode = '23514', message = 'Une mission compte au maximum 6 photos (1 principale + 5).';
      end if;
    end if;
  else
    if new.mission_id is distinct from old.mission_id
       or new.external_mission_id is distinct from old.external_mission_id
       or new.image_url is distinct from old.image_url
       or new.storage_path is distinct from old.storage_path
       or new.source is distinct from old.source
       or new.source_url is distinct from old.source_url
       or new.rights_attested_by is distinct from old.rights_attested_by then
      raise exception using errcode = '42501', message = 'Image non modifiable : supprimez-la et ajoutez-en une nouvelle.';
    end if;
    if (new.rights_status is distinct from old.rights_status
        or new.rights_note is distinct from old.rights_note
        or new.license is distinct from old.license
        or new.attribution is distinct from old.attribution)
       and not (coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.has_founder_access()) then
      raise exception using errcode = '42501', message = 'Seule l''equipe UROSI peut modifier les droits d''une image.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mission_images_guard on public.mission_images;
create trigger trg_mission_images_guard
  before insert or update on public.mission_images
  for each row execute function public.mission_images_guard();

alter table public.mission_images enable row level security;

-- Public : images aux droits connus des missions visibles publiquement.
drop policy if exists "mission_images: public read" on public.mission_images;
create policy "mission_images: public read"
  on public.mission_images for select
  to anon, authenticated
  using (
    rights_status <> 'unknown'
    and (
      (mission_id is not null and exists (
        select 1 from public.public_solidarity_missions p where p.id = mission_images.mission_id))
      or (external_mission_id is not null and exists (
        select 1 from public.external_missions e where e.id = mission_images.external_mission_id and e.is_active))
    )
  );

drop policy if exists "mission_images: owner read" on public.mission_images;
create policy "mission_images: owner read"
  on public.mission_images for select
  to authenticated
  using (mission_id is not null and public.owns_mission(mission_id));

drop policy if exists "mission_images: founder read" on public.mission_images;
create policy "mission_images: founder read"
  on public.mission_images for select
  to authenticated
  using (public.has_founder_access());

-- Une structure n'ajoute que ses propres photos, televersees dans son
-- dossier du bucket, droits attestes par elle-meme.
drop policy if exists "mission_images: owner insert" on public.mission_images;
create policy "mission_images: owner insert"
  on public.mission_images for insert
  to authenticated
  with check (
    mission_id is not null
    and external_mission_id is null
    and public.owns_mission(mission_id)
    and source = 'structure_upload'
    and rights_status = 'authorized'
    and rights_attested_by = (select auth.uid())
    and created_by = (select auth.uid())
    and storage_path like (
      (select m.structure_id::text from public.missions m where m.id = mission_images.mission_id)
      || '/' || mission_id::text || '/%')
    and image_url like '%/storage/v1/object/public/mission-images/' || storage_path
  );

drop policy if exists "mission_images: owner update" on public.mission_images;
create policy "mission_images: owner update"
  on public.mission_images for update
  to authenticated
  using (mission_id is not null and public.owns_mission(mission_id))
  with check (mission_id is not null and public.owns_mission(mission_id));

drop policy if exists "mission_images: owner delete" on public.mission_images;
create policy "mission_images: owner delete"
  on public.mission_images for delete
  to authenticated
  using (mission_id is not null and public.owns_mission(mission_id));

grant select on public.mission_images to anon, authenticated;
grant insert, delete on public.mission_images to authenticated;
grant update (is_primary, position, alt_text) on public.mission_images to authenticated;

-- Changer l'image principale en une seule operation (l'index unique
-- interdit deux principales, meme transitoirement).
create or replace function public.set_mission_primary_image(p_image_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission uuid;
begin
  select i.mission_id into v_mission from public.mission_images i where i.id = p_image_id;
  if v_mission is null then
    raise exception 'Image introuvable.';
  end if;
  if not (public.owns_mission(v_mission) or public.has_founder_access()) then
    raise exception using errcode = '42501', message = 'Cette mission ne vous appartient pas.';
  end if;
  update public.mission_images set is_primary = false where mission_id = v_mission and is_primary and id <> p_image_id;
  update public.mission_images set is_primary = true where id = p_image_id;
end;
$$;

revoke all on function public.set_mission_primary_image(uuid) from public, anon;
grant execute on function public.set_mission_primary_image(uuid) to authenticated;

-- Verification humaine des droits d'une image trouvee par l'agent
-- (ex. passer « unknown » a « authorized » apres accord ecrit).
create or replace function public.founder_set_image_rights(p_image_id uuid, p_rights_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_founder_access() then
    raise exception using errcode = '42501', message = 'Réservé à l''équipe UROSI.';
  end if;
  if p_rights_status not in ('source_provided', 'licensed', 'authorized', 'unknown') then
    raise exception 'Statut de droits invalide.';
  end if;
  update public.mission_images
  set rights_status = p_rights_status,
      rights_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), rights_note),
      is_primary = case when p_rights_status = 'unknown' then false else is_primary end
  where id = p_image_id;
  if not found then
    raise exception 'Image introuvable.';
  end if;
end;
$$;

revoke all on function public.founder_set_image_rights(uuid, text, text) from public, anon;
grant execute on function public.founder_set_image_rights(uuid, text, text) to authenticated;

-- Bucket des photos de mission : {structure_id}/{mission_id}/{fichier}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mission-images', 'mission-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mission-images: structure upload" on storage.objects;
create policy "mission-images: structure upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'mission-images'
  and exists (
    select 1 from public.missions m
    join public.structures s on s.id = m.structure_id
    where s.owner_id = (select auth.uid())
      and s.id::text = (storage.foldername(objects.name))[1]
      and m.id::text = (storage.foldername(objects.name))[2]
  )
);

drop policy if exists "mission-images: structure delete" on storage.objects;
create policy "mission-images: structure delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'mission-images'
  and exists (
    select 1 from public.structures s
    where s.owner_id = (select auth.uid()) and s.id::text = (storage.foldername(objects.name))[1]
  )
);

-- ---------------------------------------------------------------------------
-- 4. Catalogue public natif : image principale (colonnes ajoutees en fin de
--    vue, definition identique pour le reste).
-- ---------------------------------------------------------------------------
create or replace view public.public_solidarity_missions
with (security_barrier = true) as
select
  m.id, m.structure_id, m.title, m.detail, m.city, m.address, m.location, m.lat, m.lng,
  m.scheduled_date, m.start_time, m.end_time, m.duration_minutes, m.mission_category,
  m.places, m.positions,
  coalesce(nullif(s.trade_name, ''), s.name) as structure_name,
  s.logo_url as structure_logo_url,
  s.verification_status as structure_verification_status,
  (
    select i.image_url from public.mission_images i
    where i.mission_id = m.id and i.rights_status <> 'unknown'
    order by i.is_primary desc, i.position, i.created_at
    limit 1
  ) as primary_image_url,
  (select count(*)::int from public.mission_images i where i.mission_id = m.id and i.rights_status <> 'unknown') as image_count
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

-- ---------------------------------------------------------------------------
-- 5. Journal de synchronisation de l'agent (table d'import existante,
--    enrichie). source = 'mission_agent' pour une execution de l'agent.
-- ---------------------------------------------------------------------------
alter table public.external_import_runs add column if not exists created_count integer not null default 0;
alter table public.external_import_runs add column if not exists updated_count integer not null default 0;
alter table public.external_import_runs add column if not exists unchanged_count integer not null default 0;
alter table public.external_import_runs add column if not exists reactivated_count integer not null default 0;
alter table public.external_import_runs add column if not exists duplicates integer not null default 0;
alter table public.external_import_runs add column if not exists without_image integer not null default 0;
alter table public.external_import_runs add column if not exists images_found integer not null default 0;
alter table public.external_import_runs add column if not exists images_rejected integer not null default 0;
alter table public.external_import_runs add column if not exists sources_report jsonb not null default '[]'::jsonb;
alter table public.external_import_runs add column if not exists errors jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 6. Operations de l'agent (service_role uniquement).
-- ---------------------------------------------------------------------------

-- Desactive les missions dont la date de fin est passee.
create or replace function public.agent_deactivate_expired()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.external_missions
  set is_active = false, deactivation_reason = 'expired', updated_at = now()
  where is_active and ends_at is not null and ends_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Marque les doublons (titre + structure + lieu + date). Priorite : la
-- mission native UROSI, puis la mission externe importee la premiere.
-- Retourne le nombre de doublons actifs.
create or replace function public.agent_refresh_duplicates()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with ext as (
    select e.id, e.dedupe_key, e.imported_at
    from public.external_missions e
    where e.is_active and e.dedupe_key is not null
  ),
  native as (
    select public.mission_dedupe_key(p.title, p.structure_name, p.city, p.scheduled_date) as dedupe_key, p.id
    from public.public_solidarity_missions p
  ),
  resolved as (
    select e.id,
      (select n.id from native n where n.dedupe_key = e.dedupe_key order by n.id limit 1) as dup_mission,
      (select o.id from ext o
        where o.dedupe_key = e.dedupe_key and (o.imported_at, o.id) < (e.imported_at, e.id)
        order by o.imported_at, o.id limit 1) as dup_external
    from ext e
  )
  update public.external_missions x
  set duplicate_of_mission = r.dup_mission,
      duplicate_of_external = case when r.dup_mission is null then r.dup_external end
  from resolved r
  where x.id = r.id
    and (x.duplicate_of_mission is distinct from r.dup_mission
      or x.duplicate_of_external is distinct from (case when r.dup_mission is null then r.dup_external end));

  select count(*) into v_count
  from public.external_missions
  where is_active and (duplicate_of_mission is not null or duplicate_of_external is not null);
  return v_count;
end;
$$;

revoke all on function public.agent_deactivate_expired() from public, anon, authenticated;
revoke all on function public.agent_refresh_duplicates() from public, anon, authenticated;
grant execute on function public.agent_deactivate_expired() to service_role;
grant execute on function public.agent_refresh_duplicates() to service_role;

-- ---------------------------------------------------------------------------
-- 7. Centre Fondateur : vue « Agent Missions ».
-- ---------------------------------------------------------------------------

-- Prochaine execution d'une planification « M */H * * * » (UTC, pg_cron).
create or replace function public.next_cron_run(p_schedule text, p_from timestamptz default now())
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_match text[];
  v_minute integer;
  v_step integer;
  v_candidate timestamp;
  v_base timestamp := date_trunc('hour', p_from at time zone 'UTC');
begin
  v_match := regexp_match(coalesce(p_schedule, ''), '^\s*(\d{1,2})\s+\*/(\d{1,2})\s+\*\s+\*\s+\*\s*$');
  if v_match is null then
    return null;
  end if;
  v_minute := v_match[1]::integer;
  v_step := v_match[2]::integer;
  if v_minute > 59 or v_step < 1 or v_step > 23 then
    return null;
  end if;
  for i in 0..48 loop
    v_candidate := v_base + make_interval(hours => i, mins => v_minute);
    if extract(hour from v_candidate)::integer % v_step = 0
       and (v_candidate at time zone 'UTC') > p_from then
      return v_candidate at time zone 'UTC';
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.founder_mission_agent_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job jsonb;
begin
  if not public.has_founder_access() then
    raise exception using errcode = '42501', message = 'Réservé à l''équipe UROSI.';
  end if;

  -- Planification pg_cron (absente tant que le cron reel n'est pas active).
  if to_regclass('cron.job') is not null then
    execute $q$
      select jsonb_build_object('jobname', j.jobname, 'schedule', j.schedule, 'active', j.active)
      from cron.job j where j.jobname = 'mission-agent' limit 1
    $q$ into v_job;
  end if;

  return jsonb_build_object(
    'schedule', v_job,
    'next_run_at', case when coalesce((v_job ->> 'active')::boolean, false)
                        then public.next_cron_run(v_job ->> 'schedule') end,
    'last_run', (
      select to_jsonb(r) from public.external_import_runs r
      where r.source = 'mission_agent'
      order by r.started_at desc limit 1
    ),
    'runs', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.started_at desc)
      from (
        select * from public.external_import_runs
        where source = 'mission_agent'
        order by started_at desc limit 20
      ) r
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'source_type', s.source_type, 'enabled', s.enabled,
        'automated_access_allowed', s.automated_access_allowed,
        'mission_images_reusable', s.mission_images_reusable,
        'logos_reusable', s.logos_reusable,
        'reuse_basis', s.reuse_basis, 'verified_at', s.verified_at,
        'active', (select count(*) from public.external_missions e where e.source = s.id and e.is_active),
        'inactive', (select count(*) from public.external_missions e where e.source = s.id and not e.is_active),
        'last_checked_at', (select max(e.last_checked_at) from public.external_missions e where e.source = s.id)
      ) order by s.enabled desc, s.name)
      from public.mission_sources s
    ), '[]'::jsonb),
    'catalog', jsonb_build_object(
      'active', (select count(*) from public.external_missions where is_active),
      'duplicates', (select count(*) from public.external_missions
                     where is_active and (duplicate_of_mission is not null or duplicate_of_external is not null)),
      'without_image', (select count(*) from public.external_missions
                        where is_active and coalesce(image_source, 'urosi_illustration') = 'urosi_illustration'),
      'without_photo', (select count(*) from public.external_missions
                        where is_active and coalesce(image_source, 'urosi_illustration')
                          not in ('partner_mission_image', 'authorized_image')),
      'native_without_photo', (select count(*) from public.public_solidarity_missions where image_count = 0),
      'images_found', (select count(*) from public.mission_images where external_mission_id is not null and rights_status <> 'unknown'),
      'images_rejected', (select count(*) from public.mission_images where rights_status = 'unknown'),
      'by_image_source', coalesce((
        select jsonb_object_agg(k, n) from (
          select coalesce(image_source, 'urosi_illustration') as k, count(*) as n
          from public.external_missions where is_active group by 1
        ) x
      ), '{}'::jsonb)
    ),
    'rejected_images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'image_url', i.image_url, 'source', i.source, 'source_url', i.source_url,
        'rights_note', i.rights_note, 'created_at', i.created_at,
        'mission_title', e.title, 'mission_source', e.source
      ) order by i.created_at desc)
      from (select * from public.mission_images where rights_status = 'unknown' order by created_at desc limit 20) i
      left join public.external_missions e on e.id = i.external_mission_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.founder_mission_agent_overview() from public, anon;
grant execute on function public.founder_mission_agent_overview() to authenticated;

$mig1$;
  r := r || jsonb_build_object('00_migrations_appliquees', true);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', s_id, 'authenticated', 'authenticated', 'enrich-asso@urosi.internal', '', now(), '{"provider":"email"}', '{"full_name":"Asso Photo","role":"structure_admin"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', o_id, 'authenticated', 'authenticated', 'enrich-autre@urosi.internal', '', now(), '{"provider":"email"}', '{"full_name":"Autre Asso","role":"structure_admin"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', f_id, 'authenticated', 'authenticated', 'enrich-fondateur@urosi.internal', '', now(), '{"provider":"email","is_founder":true}', '{"full_name":"Fondateur Test","role":"worker"}', now(), now());

  -- Structure A (asso vérifiée) + mission solidaire publiée
  perform set_config('request.jwt.claims', json_build_object('sub', s_id, 'role', 'authenticated', 'email', 'enrich-asso@urosi.internal')::text, true);
  set local role authenticated;
  insert into public.structures (owner_id, name, siret) values (s_id, 'Asso Photo Test', '12345678900012') returning id into v_struct;
  perform public.apply_structure_siret_verification(v_struct, 'verified', p_legal_category_code => '9220');
  insert into public.missions (structure_id, title, detail, city, address, location, scheduled_date, start_time, end_time, starts_at, ends_at, duration_minutes, duration_minutes_per_person, mission_days, slots, places, positions, worker_rate_cents, base_rate_cents, hourly_rate, worker_amount, worker_subtotal, service_fee, structure_total, total_worker_hours, time_slot, day_of_week, mission_category, is_solidaire, no_salaried_substitution)
  values (v_struct, 'Collecte de jouets (test enrich)', 'Collecter', 'Lille', '1 rue Test, Lille', '1 rue Test, Lille', current_date + 4, '10:00', '12:00', (current_date + 4) + time '10:00', (current_date + 4) + time '12:00', 120, 120, 1,
          jsonb_build_array(jsonb_build_object('date', (current_date + 4)::text, 'start', '10:00', 'end', '12:00')), 2, 2, 0, null, null, 0, 0, 0, 0, 4, 'morning', 'monday', 'solidarite', true, true)
  returning id into v_mission;
  reset role;
  r := r || jsonb_build_object('01_mission_native_publiee', v_mission is not null);

  v_base := 'https://nksxwbkpazcyoumcwzll.supabase.co/storage/v1/object/public/mission-images/';
  v_path := v_struct::text || '/' || v_mission::text || '/principale.jpg';

  -- 02 : la structure dépose le fichier dans SON dossier du bucket
  begin
    set local role authenticated;
    insert into storage.objects (bucket_id, name, owner) values ('mission-images', v_path, s_id);
    reset role;
    r := r || jsonb_build_object('02_upload_bucket_dossier_structure', 'ok');
  exception when others then reset role; r := r || jsonb_build_object('02_upload_bucket_dossier_structure', 'ERREUR: ' || sqlerrm);
  end;

  -- 03 : image principale (droits attestés)
  begin
    set local role authenticated;
    insert into public.mission_images (mission_id, image_url, storage_path, source, rights_status, rights_attested_by, rights_attested_at, is_primary, position, created_by)
    values (v_mission, v_base || v_path, v_path, 'structure_upload', 'authorized', s_id, now(), true, 0, s_id) returning id into v_img1;
    reset role;
    r := r || jsonb_build_object('03_photo_principale_ajoutee', v_img1 is not null);
  exception when others then reset role; r := r || jsonb_build_object('03_photo_principale_ajoutee', 'ERREUR: ' || sqlerrm);
  end;

  -- 04 : URL externe arbitraire refusée (pas de photo copiée du web)
  begin
    set local role authenticated;
    insert into public.mission_images (mission_id, image_url, storage_path, source, rights_status, rights_attested_by, position, created_by)
    values (v_mission, 'https://site-tiers.example.org/photo.jpg', v_struct::text || '/' || v_mission::text || '/x.jpg', 'structure_upload', 'authorized', s_id, 1, s_id);
    reset role;
    r := r || jsonb_build_object('04_url_externe_refusee', false);
  exception when others then reset role; r := r || jsonb_build_object('04_url_externe_refusee', 'oui: ' || sqlerrm);
  end;

  -- 05 : droits « unknown » refusés pour une structure
  begin
    set local role authenticated;
    insert into public.mission_images (mission_id, image_url, storage_path, source, rights_status, rights_attested_by, position, created_by)
    values (v_mission, v_base || v_struct::text || '/' || v_mission::text || '/u.jpg', v_struct::text || '/' || v_mission::text || '/u.jpg', 'structure_upload', 'unknown', s_id, 1, s_id);
    reset role;
    r := r || jsonb_build_object('05_droits_inconnus_refuses', false);
  exception when others then reset role; r := r || jsonb_build_object('05_droits_inconnus_refuses', 'oui: ' || sqlerrm);
  end;

  -- 06 : 5 photos facultatives acceptées, la 7e refusée
  begin
    set local role authenticated;
    for i in 1..5 loop
      insert into public.mission_images (mission_id, image_url, storage_path, source, rights_status, rights_attested_by, position, created_by)
      values (v_mission, v_base || v_struct::text || '/' || v_mission::text || '/p' || i || '.jpg', v_struct::text || '/' || v_mission::text || '/p' || i || '.jpg', 'structure_upload', 'authorized', s_id, i, s_id)
      returning id into v_img2;
    end loop;
    reset role;
    r := r || jsonb_build_object('06a_cinq_photos_facultatives', (select count(*) from public.mission_images where mission_id = v_mission) = 6);
  exception when others then reset role; r := r || jsonb_build_object('06a_cinq_photos_facultatives', 'ERREUR: ' || sqlerrm);
  end;
  begin
    set local role authenticated;
    insert into public.mission_images (mission_id, image_url, storage_path, source, rights_status, rights_attested_by, position, created_by)
    values (v_mission, v_base || v_struct::text || '/' || v_mission::text || '/p6.jpg', v_struct::text || '/' || v_mission::text || '/p6.jpg', 'structure_upload', 'authorized', s_id, 5, s_id);
    reset role;
    r := r || jsonb_build_object('06b_septieme_refusee', false);
  exception when others then reset role; r := r || jsonb_build_object('06b_septieme_refusee', 'oui: ' || sqlerrm);
  end;

  -- 07 : une seule principale ; bascule atomique via RPC
  begin
    set local role authenticated;
    update public.mission_images set is_primary = true where id = v_img2;
    reset role;
    r := r || jsonb_build_object('07a_deux_principales_refusees', false);
  exception when others then reset role; r := r || jsonb_build_object('07a_deux_principales_refusees', 'oui: ' || sqlerrm);
  end;
  begin
    set local role authenticated;
    perform public.set_mission_primary_image(v_img2);
    reset role;
    r := r || jsonb_build_object('07b_changement_principale', (select array_agg(id) from public.mission_images where mission_id = v_mission and is_primary) = array[v_img2]);
  exception when others then reset role; r := r || jsonb_build_object('07b_changement_principale', 'ERREUR: ' || sqlerrm);
  end;

  -- 08 : remplacement = suppression + ajout ; modifier l'URL ou les droits est interdit
  begin
    set local role authenticated;
    update public.mission_images set image_url = v_base || 'autre.jpg' where id = v_img1;
    reset role;
    r := r || jsonb_build_object('08a_url_non_modifiable', false);
  exception when others then reset role; r := r || jsonb_build_object('08a_url_non_modifiable', 'oui: ' || sqlerrm);
  end;
  begin
    set local role authenticated;
    update public.mission_images set rights_status = 'licensed' where id = v_img1;
    reset role;
    r := r || jsonb_build_object('08b_droits_non_modifiables_par_structure', false);
  exception when others then reset role; r := r || jsonb_build_object('08b_droits_non_modifiables_par_structure', 'oui: ' || sqlerrm);
  end;
  begin
    set local role authenticated;
    update public.mission_images set position = 3 where id = v_img1;
    delete from public.mission_images where id = v_img1;
    reset role;
    r := r || jsonb_build_object('08c_suppression_par_structure', not exists (select 1 from public.mission_images where id = v_img1));
  exception when others then reset role; r := r || jsonb_build_object('08c_suppression_par_structure', 'ERREUR: ' || sqlerrm);
  end;

  -- 09 : une autre structure ne peut ni ajouter, ni supprimer, ni déposer de fichier
  perform set_config('request.jwt.claims', json_build_object('sub', o_id, 'role', 'authenticated', 'email', 'enrich-autre@urosi.internal')::text, true);
  begin
    set local role authenticated;
    insert into public.mission_images (mission_id, image_url, storage_path, source, rights_status, rights_attested_by, position, created_by)
    values (v_mission, v_base || v_struct::text || '/' || v_mission::text || '/intrus.jpg', v_struct::text || '/' || v_mission::text || '/intrus.jpg', 'structure_upload', 'authorized', o_id, 1, o_id);
    reset role;
    r := r || jsonb_build_object('09a_autre_structure_ajout_refuse', false);
  exception when others then reset role; r := r || jsonb_build_object('09a_autre_structure_ajout_refuse', 'oui: ' || sqlerrm);
  end;
  begin
    set local role authenticated;
    delete from public.mission_images where mission_id = v_mission;
    get diagnostics v_n = row_count;
    reset role;
    r := r || jsonb_build_object('09b_autre_structure_suppression_sans_effet', v_n = 0);
  exception when others then reset role; r := r || jsonb_build_object('09b_autre_structure_suppression_sans_effet', 'oui: ' || sqlerrm);
  end;
  begin
    set local role authenticated;
    insert into storage.objects (bucket_id, name, owner) values ('mission-images', v_struct::text || '/' || v_mission::text || '/intrus.jpg', o_id);
    reset role;
    r := r || jsonb_build_object('09c_autre_structure_upload_refuse', false);
  exception when others then reset role; r := r || jsonb_build_object('09c_autre_structure_upload_refuse', 'oui: ' || sqlerrm);
  end;

  -- 10 : public (sans compte) : photos visibles, image principale dans la vue
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    set local role anon;
    select count(*) into v_n from public.mission_images where mission_id = v_mission;
    select jsonb_build_object('primary', primary_image_url, 'count', image_count) into v_json from public.public_solidarity_missions where id = v_mission;
    reset role;
    r := r || jsonb_build_object('10_public_voit_photos', v_n = 5, '10_vue_image_principale', v_json);
  exception when others then reset role; r := r || jsonb_build_object('10_public_voit_photos', 'ERREUR: ' || sqlerrm);
  end;

  -- 11 : provenance + doublons (titre + structure + lieu + date)
  insert into public.external_missions (source, source_type, source_name, source_url, external_id, title, organization_name, category, city, starts_at, application_url, image_source, image_rights_status, domain_logo_url, organization_logo_url, last_checked_at, last_changed_at, imported_at)
  values
    ('api_engagement', 'api', 'API Engagement', 'https://api.api-engagement.beta.gouv.fr/v0/mission/enrich-1', 'enrich-1', 'Maraude du soir', 'Solidarité Nord', 'aide_alimentaire', 'Lille', now() + interval '3 days', 'https://api.api-engagement.beta.gouv.fr/r/enrich-1/pub', 'organization_logo', 'source_provided', null, 'https://cdn.example.org/logo.png', now(), now(), now() - interval '1 day'),
    ('api_engagement', 'api', 'API Engagement', 'https://api.api-engagement.beta.gouv.fr/v0/mission/enrich-2', 'enrich-2', 'MARAUDE du soir !', 'Solidarité  Nord', 'aide_alimentaire', 'LILLE', now() + interval '3 days', 'https://api.api-engagement.beta.gouv.fr/r/enrich-2/pub', 'urosi_illustration', null, null, null, now(), now(), now()),
    ('api_engagement', 'api', 'API Engagement', 'https://api.api-engagement.beta.gouv.fr/v0/mission/enrich-3', 'enrich-3', 'Collecte de jouets (test enrich)', 'Asso Photo Test', 'solidarite', 'Lille', ((current_date + 4) + time '10:00') at time zone 'Europe/Paris', 'https://api.api-engagement.beta.gouv.fr/r/enrich-3/pub', 'domain_logo', 'source_provided', 'https://cdn.example.org/d.png', null, now(), now(), now()),
    ('api_engagement', 'api', 'API Engagement', 'https://api.api-engagement.beta.gouv.fr/v0/mission/enrich-4', 'enrich-4', 'Mission terminée', 'Asso X', 'autre', 'Lille', now() - interval '10 days', 'https://api.api-engagement.beta.gouv.fr/r/enrich-4/pub', 'urosi_illustration', null, null, null, now(), now(), now());
  update public.external_missions set ends_at = now() - interval '2 days' where external_id = 'enrich-4';
  select id into v_ext from public.external_missions where external_id = 'enrich-1';
  select id into v_ext2 from public.external_missions where external_id = 'enrich-2';
  r := r || jsonb_build_object('11a_cle_dedoublonnage', (select dedupe_key from public.external_missions where id = v_ext) = (select dedupe_key from public.external_missions where id = v_ext2));
  v_n := public.agent_refresh_duplicates();
  r := r || jsonb_build_object('11b_doublons_detectes', v_n,
    '11c_doublon_externe_rattache_au_premier', (select duplicate_of_external from public.external_missions where id = v_ext2) = v_ext,
    '11d_doublon_de_mission_native', (select duplicate_of_mission from public.external_missions where external_id = 'enrich-3') = v_mission);
  begin
    set local role anon;
    select count(*) into v_n from public.external_missions where external_id like 'enrich-%';
    reset role;
    r := r || jsonb_build_object('11e_public_ne_voit_pas_les_doublons', v_n);
  exception when others then reset role; r := r || jsonb_build_object('11e_public_ne_voit_pas_les_doublons', 'ERREUR: ' || sqlerrm);
  end;

  -- 12 : expiration = désactivation (jamais suppression), puis réactivation
  v_n := public.agent_deactivate_expired();
  r := r || jsonb_build_object('12a_expirees_desactivees', v_n,
    '12b_conservee_avec_motif', (select jsonb_build_object('actif', is_active, 'motif', deactivation_reason, 'date', deactivated_at is not null) from public.external_missions where external_id = 'enrich-4'));
  update public.external_missions set is_active = true, ends_at = now() + interval '1 day' where external_id = 'enrich-4';
  r := r || jsonb_build_object('12c_reactivation_efface_motif', (select deactivation_reason is null and deactivated_at is null from public.external_missions where external_id = 'enrich-4'));

  -- 13 : image trouvée aux droits inconnus : stockée, jamais publique ni principale
  insert into public.mission_images (external_mission_id, image_url, source, source_url, rights_status, rights_note)
  values (v_ext, 'https://site-tiers.example.org/vue.jpg', 'authorized_source', 'https://site-tiers.example.org/page', 'unknown', 'Licence non indiquée') returning id into v_img3;
  insert into public.mission_images (external_mission_id, image_url, source, source_url, rights_status, license, is_primary)
  values (v_ext, 'https://images.example.org/libre.jpg', 'authorized_source', 'https://images.example.org/libre', 'licensed', 'CC BY 4.0', true);
  begin
    update public.mission_images set is_primary = true where id = v_img3;
    r := r || jsonb_build_object('13a_inconnue_jamais_principale', false);
  exception when others then r := r || jsonb_build_object('13a_inconnue_jamais_principale', 'oui: ' || sqlerrm);
  end;
  begin
    set local role anon;
    select array_agg(rights_status) into v_arr from public.mission_images where external_mission_id = v_ext;
    reset role;
    r := r || jsonb_build_object('13b_public_ne_voit_que_droits_connus', v_arr);
  exception when others then reset role; r := r || jsonb_build_object('13b_public_ne_voit_que_droits_connus', 'ERREUR: ' || sqlerrm);
  end;

  -- 14 : registre des sources
  begin
    insert into public.mission_sources (id, name, source_type, adapter, base_url, enabled) values ('site_test', 'Site test', 'authorized_page', 'x', 'https://site.example.org', true);
    r := r || jsonb_build_object('14a_source_non_autorisee_non_activable', false);
  exception when others then r := r || jsonb_build_object('14a_source_non_autorisee_non_activable', 'oui: ' || sqlerrm);
  end;
  begin
    insert into public.external_missions (source, external_id, title, application_url) values ('source_inconnue', 'x', 'Mission', 'https://example.org/x');
    r := r || jsonb_build_object('14b_source_hors_registre_refusee', false);
  exception when others then r := r || jsonb_build_object('14b_source_hors_registre_refusee', 'oui: ' || sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', s_id, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    select count(*) into v_n from public.mission_sources;
    reset role;
    r := r || jsonb_build_object('14c_structure_ne_lit_pas_le_registre', v_n = 0);
  exception when others then reset role; r := r || jsonb_build_object('14c_structure_ne_lit_pas_le_registre', 'ERREUR: ' || sqlerrm);
  end;
  begin
    set local role authenticated;
    perform public.agent_refresh_duplicates();
    reset role;
    r := r || jsonb_build_object('14d_fonctions_agent_reservees_service_role', false);
  exception when others then reset role; r := r || jsonb_build_object('14d_fonctions_agent_reservees_service_role', 'oui: ' || sqlerrm);
  end;

  -- 15 : Centre Fondateur « Agent Missions »
  insert into public.external_import_runs (source, trigger, status, finished_at, fetched, created_count, updated_count, deactivated, duplicates, without_image, images_found, images_rejected, sources_report, errors)
  values ('mission_agent', 'manual', 'not_configured', now(), 0, 0, 0, 0, 0, 0, 0, 0, '[{"source":"api_engagement","status":"not_configured"}]', '[]');
  perform set_config('request.jwt.claims', json_build_object('sub', f_id, 'role', 'authenticated', 'app_metadata', json_build_object('is_founder', true))::text, true);
  begin
    set local role authenticated;
    v_json := public.founder_mission_agent_overview();
    reset role;
    r := r || jsonb_build_object('15_vue_fondateur', jsonb_build_object(
      'last_run_status', v_json -> 'last_run' ->> 'status',
      'next_run_at', v_json -> 'next_run_at',
      'schedule', v_json -> 'schedule',
      'sources', (select jsonb_agg(s ->> 'id') from jsonb_array_elements(v_json -> 'sources') s),
      'catalog', v_json -> 'catalog',
      'rejected_images', jsonb_array_length(v_json -> 'rejected_images')));
  exception when others then reset role; r := r || jsonb_build_object('15_vue_fondateur', 'ERREUR: ' || sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', s_id, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    v_json := public.founder_mission_agent_overview();
    reset role;
    r := r || jsonb_build_object('15b_vue_fondateur_refusee_aux_structures', false);
  exception when others then reset role; r := r || jsonb_build_object('15b_vue_fondateur_refusee_aux_structures', 'oui: ' || sqlerrm);
  end;

  -- 16 : prochaine exécution (toutes les 3 h à la minute 14, UTC)
  r := r || jsonb_build_object('16_prochaine_execution', jsonb_build_array(
    public.next_cron_run('14 */3 * * *', '2026-09-27 10:00:00+00'),
    public.next_cron_run('14 */3 * * *', '2026-09-27 12:14:00+00'),
    public.next_cron_run('14 */3 * * *', '2026-09-27 22:30:00+00'),
    public.next_cron_run('0 9 * * *', '2026-09-27 10:00:00+00')));

  raise exception 'E2E_REPORT %', jsonb_pretty(r);
end;
$test$;
