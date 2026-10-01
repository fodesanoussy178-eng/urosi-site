-- Sécurisation de la confirmation de participation (parcours Phase 0).
--
-- Principe : la pastille verte signifie EXACTEMENT « participation confirmée
-- par la structure ». Rien d'autre ne la produit : ni une déclaration du
-- participant, ni une vérification de l'équipe UROSI, ni une méthode dont la
-- disponibilité serait simulée.
--
-- Trois méthodes de vérification sont prévues ; une seule est active
-- aujourd'hui pour les missions externes, et seulement quand elle est réelle :
--   partner_status            statut transmis par la plateforme partenaire.
--                             Aucune source ne le fournit aujourd'hui
--                             (mission_sources.partner_status_available =
--                             false) : jamais utilisée tant que ce n'est pas
--                             le cas.
--   structure_confirmation    la structure répond via un lien unique, émis
--                             par l'équipe UROSI SEULEMENT vers un canal
--                             officiel qu'elle a vérifié (jamais d'email
--                             supposé, aucun envoi automatique), avec
--                             expiration.
--   urosi_native_confirmation la structure est inscrite et vérifiée sur UROSI
--                             (mission native, ou mission externe dont le
--                             SIREN de l'organisation correspond) : elle
--                             confirme dans son espace, en un clic.
--
-- Strictement additif sur les données. Dépend de 20260928120000.

-- ---------------------------------------------------------------------------
-- 1. Traçabilité de la méthode et du canal.
-- ---------------------------------------------------------------------------
alter table public.external_applications add column if not exists verification_method text;
alter table public.external_applications add column if not exists confirmation_expires_at timestamptz;
alter table public.external_applications add column if not exists confirmation_channel_note text;
alter table public.external_applications add column if not exists confirmation_issued_by uuid
  references public.profiles (id) on delete set null;
alter table public.external_applications add column if not exists confirmed_by_structure_id uuid
  references public.structures (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'external_applications_verification_method_check') then
    alter table public.external_applications add constraint external_applications_verification_method_check
      check (verification_method is null or verification_method in ('partner_status', 'structure_confirmation', 'urosi_native_confirmation'));
  end if;
  -- Une expérience confirmée l'est toujours par une méthode identifiée.
  if not exists (select 1 from pg_constraint where conname = 'external_applications_verified_has_method') then
    alter table public.external_applications add constraint external_applications_verified_has_method
      check (status <> 'verified_completed' or verification_method is not null) not valid;
  end if;
end;
$$;

alter table public.mission_sources add column if not exists partner_status_available boolean not null default false;
comment on column public.mission_sources.partner_status_available is
  'La source transmet-elle un statut de participation exploitable ? Faux pour toutes les sources aujourd''hui (API Engagement v0 ne le fait pas).';

-- Les liens déjà générés automatiquement à la déclaration (version
-- précédente) sont retirés : un lien n'existe plus que s'il a été émis
-- vers un canal officiel vérifié.
update public.external_applications
set confirmation_token = null, confirmation_requested_at = null
where structure_answer is null and confirmation_issued_by is null and confirmation_token is not null;

-- ---------------------------------------------------------------------------
-- 2. Structure inscrite sur UROSI correspondant à l'organisation d'une
--    mission externe (SIREN identique, structure vérifiée). Jamais de
--    correspondance approximative par nom.
-- ---------------------------------------------------------------------------
create or replace function public.external_mission_urosi_structure(p_external_mission_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.external_missions m
  join public.structures s
    on coalesce(nullif(s.siren, ''), left(regexp_replace(coalesce(s.siret, ''), '\D', '', 'g'), 9))
       = regexp_replace(coalesce(m.organization_siren, ''), '\D', '', 'g')
  where m.id = p_external_mission_id
    and length(regexp_replace(coalesce(m.organization_siren, ''), '\D', '', 'g')) = 9
    and s.verification_status in ('verified', 'founder_bypass')
  order by s.verified_at nulls last, s.created_at
  limit 1;
$$;

revoke all on function public.external_mission_urosi_structure(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Déclaration : plus aucun lien créé automatiquement. Si la structure est
--    inscrite sur UROSI, elle est prévenue dans son espace (canal officiel).
-- ---------------------------------------------------------------------------
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
  v_structure uuid;
  v_owner uuid;
  v_title text;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Connexion requise.';
  end if;

  select coalesce(nullif(trim(p.public_first_name), ''), nullif(split_part(trim(p.full_name), ' ', 1), ''), 'Un bénévole')
  into v_name from public.profiles p where p.id = v_user;

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
        -- « Je n'y suis pas allé » annule toute demande de confirmation en cours.
        confirmation_token = case when p_went then confirmation_token else null end,
        confirmation_expires_at = case when p_went then confirmation_expires_at else null end
    where id = v_ext.id;
    perform set_config('urosi.journey_write', 'off', true);

    if p_went then
      v_structure := public.external_mission_urosi_structure(p_mission_id);
      if v_structure is not null then
        select s.owner_id, m.title into v_owner, v_title
        from public.structures s, public.external_missions m
        where s.id = v_structure and m.id = p_mission_id;
        perform public.notify(
          v_owner, 'participation_declared', 'Participation à confirmer',
          v_name || ' indique avoir réalisé la mission « ' || v_title || ' »'
            || coalesce(' le ' || to_char(v_ext.mission_date, 'DD/MM/YYYY'), '') || '. Pouvez-vous confirmer sa participation ?',
          jsonb_build_object('external_application_id', v_ext.id)
        );
      end if;
    end if;
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
-- 4. structure_confirmation : lien émis explicitement par l'équipe UROSI
--    vers un canal officiel vérifié (noté), valable 30 jours, usage unique.
-- ---------------------------------------------------------------------------
create or replace function public.founder_issue_confirmation_request(p_application_id uuid, p_channel_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.external_applications%rowtype;
  v_token uuid;
begin
  if not public.has_founder_access() then
    raise exception using errcode = '42501', message = 'Réservé à l''équipe UROSI.';
  end if;
  if length(trim(coalesce(p_channel_note, ''))) < 5 then
    raise exception 'Indiquez le canal officiel vérifié utilisé (ex. email publié sur le site officiel de l''association).';
  end if;
  select * into v_row from public.external_applications where id = p_application_id for update;
  if not found or v_row.status <> 'completed_declared' or v_row.structure_answer is not null then
    raise exception 'Aucune participation à confirmer.';
  end if;
  v_token := gen_random_uuid();
  perform set_config('urosi.journey_write', 'on', true);
  update public.external_applications
  set confirmation_token = v_token,
      confirmation_requested_at = now(),
      confirmation_expires_at = now() + interval '30 days',
      confirmation_channel_note = trim(p_channel_note),
      confirmation_issued_by = auth.uid()
  where id = p_application_id;
  perform set_config('urosi.journey_write', 'off', true);
  return v_token;
end;
$$;

revoke all on function public.founder_issue_confirmation_request(uuid, text) from public, anon;
grant execute on function public.founder_issue_confirmation_request(uuid, text) to authenticated;

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
  where a.confirmation_token = p_token
    and a.user_id is not null
    and a.confirmation_issued_by is not null
    and (a.structure_answer is not null or a.confirmation_expires_at > now());
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
  select * into v_row from public.external_applications
  where confirmation_token = p_token and confirmation_issued_by is not null
  for update;
  if not found then
    raise exception 'Lien de confirmation invalide.';
  end if;
  if v_row.structure_answer is not null then
    return v_row.structure_answer; -- réponse unique, jamais modifiable par le lien
  end if;
  if v_row.confirmation_expires_at is null or v_row.confirmation_expires_at <= now() then
    raise exception 'Lien de confirmation expiré.';
  end if;
  if v_row.status <> 'completed_declared' then
    raise exception 'Aucune participation à confirmer.';
  end if;
  perform set_config('urosi.journey_write', 'on', true);
  update public.external_applications
  set structure_answer = case when p_confirmed then 'confirmed' else 'denied' end,
      structure_answered_at = now(),
      status = case when p_confirmed then 'verified_completed' else 'not_confirmed' end,
      verification_method = case when p_confirmed then 'structure_confirmation' else null end,
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

-- ---------------------------------------------------------------------------
-- 5. urosi_native_confirmation pour une mission externe : la structure
--    inscrite (même SIREN) confirme dans son espace, en un clic.
-- ---------------------------------------------------------------------------
create or replace function public.structure_pending_external_confirmations()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'participant', public.journey_display_name(a.user_id),
    'mission_title', m.title,
    'mission_date', a.mission_date
  ) order by a.participant_answered_at), '[]'::jsonb)
  from public.external_applications a
  join public.external_missions m on m.id = a.external_mission_id
  join public.structures s on s.id = public.external_mission_urosi_structure(m.id)
  where a.status = 'completed_declared'
    and a.structure_answer is null
    and s.owner_id = auth.uid();
$$;

create or replace function public.structure_answer_external_participation(p_application_id uuid, p_confirmed boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.external_applications%rowtype;
  v_structure uuid;
begin
  select * into v_row from public.external_applications where id = p_application_id for update;
  if not found then
    raise exception 'Candidature introuvable.';
  end if;
  v_structure := public.external_mission_urosi_structure(v_row.external_mission_id);
  if v_structure is null or not exists (
    select 1 from public.structures s where s.id = v_structure and s.owner_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'Cette mission n''est pas celle de votre structure.';
  end if;
  if v_row.structure_answer is not null then
    return v_row.structure_answer;
  end if;
  if v_row.status <> 'completed_declared' then
    raise exception 'Aucune participation à confirmer.';
  end if;
  perform set_config('urosi.journey_write', 'on', true);
  update public.external_applications
  set structure_answer = case when p_confirmed then 'confirmed' else 'denied' end,
      structure_answered_at = now(),
      status = case when p_confirmed then 'verified_completed' else 'not_confirmed' end,
      verification_method = case when p_confirmed then 'urosi_native_confirmation' else null end,
      confirmed_by_structure_id = v_structure,
      verified_at = case when p_confirmed then now() else null end,
      verified_by = auth.uid(),
      confirmation_token = null,
      confirmation_expires_at = null
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

revoke all on function public.structure_pending_external_confirmations() from public, anon;
revoke all on function public.structure_answer_external_participation(uuid, boolean) from public, anon;
grant execute on function public.structure_pending_external_confirmations() to authenticated;
grant execute on function public.structure_answer_external_participation(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. L'équipe UROSI ne peut plus « vérifier » une expérience à la place de
--    la structure (la pastille verte ne signifierait plus ce qu'elle dit).
-- ---------------------------------------------------------------------------
create or replace function public.founder_verify_external_application(p_application_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501',
    message = 'Seule la structure confirme une participation (lien officiel ou espace UROSI).';
end;
$$;

-- Centre Fondateur : déclarations en attente, avec la méthode réellement
-- disponible pour chacune (jamais simulée).
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
      'method', case
        when public.external_mission_urosi_structure(m.id) is not null then 'urosi_native_confirmation'
        when coalesce((select s.partner_status_available from public.mission_sources s where s.id = m.source), false) then 'partner_status'
        else 'structure_confirmation'
      end,
      'token', case when a.confirmation_expires_at > now() then a.confirmation_token end,
      'channel_note', a.confirmation_channel_note,
      'expires_at', a.confirmation_expires_at
    ) order by a.participant_answered_at)
    from public.external_applications a
    join public.external_missions m on m.id = a.external_mission_id
    where a.status = 'completed_declared' and a.structure_answer is null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.founder_pending_participations() from public, anon;
grant execute on function public.founder_pending_participations() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Profil public : uniquement les participations confirmées par la
--    structure (méthode identifiée ; missions natives : fin confirmée par la
--    structure). L'ancienne vérification « équipe » ne compte plus.
-- ---------------------------------------------------------------------------
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
    where a.user_id = p_user_id
      and a.status = 'verified_completed'
      and a.verification_method is not null
    union all
    select m.title, coalesce(nullif(s.trade_name, ''), s.name), m.scheduled_date,
           coalesce(m.duration_minutes, 0)
    from public.applications ap
    join public.missions m on m.id = ap.mission_id
    join public.structures s on s.id = m.structure_id
    where ap.worker_id = p_user_id
      and ap.cv_status = 'verified'
      and ap.attendance_status = 'end_confirmed'
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
