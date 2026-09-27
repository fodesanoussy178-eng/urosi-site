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
