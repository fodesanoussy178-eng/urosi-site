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
