-- Automatisation complete de la fin de mission : disparition de la carte
-- active (cote front, cf. WorkerApp.tsx), fermeture de la messagerie, entree
-- CV en attente de verification, demandes de note pour les deux parties.
-- Tout est regroupe dans private.finalize_mission_end(), appelee UNE SEULE
-- FOIS (garde idempotente sur cv_status) par les trois chemins de fin de
-- mission existants (confirm_attendance_qr, confirm_remote_attendance,
-- validate_mission_attendance), dans la MEME transaction que le passage du
-- statut a 'payment_pending' : la creation de la transaction wallet (trigger
-- applications_pending_wallet_earning, deja en place) se declenche donc dans
-- la meme transaction, garantissant qu'on n'a jamais une mission terminee
-- sans transaction wallet, ni de CV en attente sans mission terminee.

-- ---------------------------------------------------------------------------
-- 1. Colonnes de suivi CV / messagerie sur applications.
-- ---------------------------------------------------------------------------
alter table public.applications add column if not exists conversation_status text not null default 'open'
  check (conversation_status in ('open', 'closed'));
alter table public.applications add column if not exists cv_status text
  check (cv_status in ('pending_verification', 'verified', 'disputed', 'rejected'));
alter table public.applications add column if not exists cv_status_reason text;
alter table public.applications add column if not exists cv_verified_at timestamptz;

create index if not exists applications_cv_status_idx on public.applications (cv_status);

-- ---------------------------------------------------------------------------
-- 2. Demandes de note (une par direction et par candidature), creees
--    automatiquement a la fin de mission. Ne bloquent jamais l'utilisateur :
--    "Me le rappeler plus tard" les laisse pending et reprogramme un rappel.
-- ---------------------------------------------------------------------------
create table if not exists public.rating_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  mission_id uuid not null references public.missions (id) on delete cascade,
  direction text not null check (direction in ('worker_to_structure', 'structure_to_worker')),
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'completed', 'dismissed')),
  created_at timestamptz not null default now(),
  last_reminded_at timestamptz,
  reminder_stage integer not null default 0,
  unique (application_id, direction)
);

create index if not exists rating_requests_reviewer_idx on public.rating_requests (reviewer_id, status);
alter table public.rating_requests enable row level security;

drop policy if exists "rating_requests: reviewer reads own" on public.rating_requests;
create policy "rating_requests: reviewer reads own"
  on public.rating_requests for select
  using (reviewer_id = auth.uid());

-- Ecriture reservee au backend (finalize_mission_end / RPC de rappel dediee) :
-- aucune policy insert/update/delete cote client.

-- ---------------------------------------------------------------------------
-- 3. ratings : colonne de visibilite (anti-representailles) + rattachement
--    direct a la mission. Publiee quand les DEUX parties ont note, ou apres
--    expiration d'un delai (auto_publish_stale_ratings, cf. edge function).
-- ---------------------------------------------------------------------------
alter table public.ratings add column if not exists mission_id uuid references public.missions (id) on delete cascade;
alter table public.ratings add column if not exists reviewer_id uuid references public.profiles (id) on delete cascade;
alter table public.ratings add column if not exists status text not null default 'pending'
  check (status in ('pending', 'published'));

update public.ratings r
set mission_id = coalesce(r.mission_id, a.mission_id),
    reviewer_id = coalesce(
      r.reviewer_id,
      case when r.direction = 'worker_to_structure' then r.worker_id else s.owner_id end
    )
from public.applications a
join public.missions m on m.id = a.mission_id
join public.structures s on s.id = m.structure_id
where a.id = r.application_id and (r.mission_id is null or r.reviewer_id is null);

-- Publie retroactivement toute paire deja complete (les deux directions
-- existent deja pour la meme candidature) : pas de retenue sur des donnees
-- historiques deja mutuellement echangees.
update public.ratings r
set status = 'published'
where r.status = 'pending'
  and exists (
    select 1 from public.ratings other
    where other.application_id = r.application_id
      and other.direction <> r.direction
  );

create or replace function public.trg_populate_rating_fields()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.mission_id is null then
    select a.mission_id into new.mission_id
    from public.applications a where a.id = new.application_id;
  end if;
  if new.reviewer_id is null then
    if new.direction = 'worker_to_structure' then
      new.reviewer_id := new.worker_id;
    else
      select s.owner_id into new.reviewer_id
      from public.structures s where s.id = new.structure_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ratings_populate_fields on public.ratings;
create trigger ratings_populate_fields
  before insert on public.ratings
  for each row execute function public.trg_populate_rating_fields();

-- Des qu'une note recoit sa contrepartie (l'autre direction sur la meme
-- candidature), les deux deviennent visibles simultanement.
create or replace function public.trg_publish_rating_pair()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.ratings other
    where other.application_id = new.application_id
      and other.direction <> new.direction
  ) then
    update public.ratings
    set status = 'published'
    where application_id = new.application_id
      and status = 'pending';
  end if;

  update public.rating_requests
  set status = 'completed'
  where application_id = new.application_id
    and direction = new.direction
    and status <> 'completed';

  return new;
end;
$$;

drop trigger if exists ratings_publish_pair on public.ratings;
create trigger ratings_publish_pair
  after insert on public.ratings
  for each row execute function public.trg_publish_rating_pair();

-- Autorise a noter des la fin de mission confirmee (attendance_status =
-- 'end_confirmed'), sans attendre le passage complet a 'completed' (J+3) :
-- la demande de note est creee au moment meme de la fin de mission.
create or replace function public.owns_ended_application(_application_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.applications a
    join public.missions m on m.id = a.mission_id
    join public.structures s on s.id = m.structure_id
    where a.id = _application_id
      and a.attendance_status = 'end_confirmed'
      and s.owner_id = auth.uid()
  );
$$;

-- Un travailleur ne doit voir la note recue de la structure qu'une fois
-- publiee (les deux ont note, ou delai expire) : evite toute representaille.
-- La structure continue de voir sa propre ecriture immediatement.
drop policy if exists "ratings: participants read own" on public.ratings;
create policy "ratings: participants read own"
  on public.ratings for select
  to authenticated
  using (
    (direction = 'worker_to_structure' and worker_id = (select auth.uid()))
    or (
      direction = 'structure_to_worker'
      and (
        (worker_id = (select auth.uid()) and status = 'published')
        or public.owns_completed_application(application_id)
        or public.owns_ended_application(application_id)
      )
    )
  );

drop policy if exists "ratings: worker rates own completed application" on public.ratings;
create policy "ratings: worker rates own completed application"
  on public.ratings for insert
  to authenticated
  with check (
    ratings.direction = 'worker_to_structure'
    and ratings.worker_id = (select auth.uid())
    and exists (
      select 1
      from public.applications a
      join public.missions m on m.id = a.mission_id
      where a.id = ratings.application_id
        and a.worker_id = (select auth.uid())
        and a.attendance_status = 'end_confirmed'
        and m.structure_id = ratings.structure_id
    )
  );

drop policy if exists "ratings: structure rates worker on completed application" on public.ratings;
create policy "ratings: structure rates worker on completed application"
  on public.ratings for insert
  to authenticated
  with check (
    ratings.direction = 'structure_to_worker'
    and public.owns_ended_application(ratings.application_id)
    and exists (
      select 1
      from public.applications a
      join public.missions m on m.id = a.mission_id
      where a.id = ratings.application_id
        and a.attendance_status = 'end_confirmed'
        and a.worker_id = ratings.worker_id
        and m.structure_id = ratings.structure_id
    )
  );

-- Les agregats publics n'incluent que les notes deja publiees.
create or replace function public.public_structure_rating_summary(p_structure_ids uuid[])
returns table (structure_id uuid, average numeric, review_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select r.*,
           row_number() over (
             partition by r.structure_id order by r.created_at, r.id
           ) as review_number
    from public.ratings r
    where r.direction = 'worker_to_structure'
      and r.status = 'published'
      and r.structure_id = any(coalesce(p_structure_ids, array[]::uuid[]))
  ), batched as (
    select ranked.*,
           count(*) over (
             partition by structure_id, ((review_number - 1) / 3)
           ) as batch_size,
           max(created_at) over (
             partition by structure_id, ((review_number - 1) / 3)
           ) as batch_completed_at
    from ranked
  ), released as (
    select *
    from batched
    where batch_size = 3
      and date_trunc('week', batch_completed_at) + interval '7 days'
          <= date_trunc('week', now())
  )
  select released.structure_id,
         round(avg(released.score), 2) as average,
         count(*) as review_count
  from released
  group by released.structure_id
$$;

create or replace function public.worker_public_rating_summary(p_worker_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentification requise.';
  end if;
  return (
    select jsonb_build_object(
      'average', round(avg(r.score), 2),
      'count', count(*)
    )
    from public.ratings r
    where r.worker_id = p_worker_id
      and r.direction = 'structure_to_worker'
      and r.status = 'published'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Effets automatiques de fin de mission (conversation, CV, demandes de
--    note). Idempotent : ne fait rien si deja applique (cv_status non nul).
-- ---------------------------------------------------------------------------
create or replace function private.finalize_mission_end(p_application_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v record;
begin
  select a.id, a.worker_id, a.mission_id, a.cv_status, s.owner_id, m.title
  into v
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
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
    v.worker_id, 'rating_request', 'Mission terminée',
    'Comment s''est passée ta mission « ' || v.title || ' » ? Ton avis nous aide.',
    jsonb_build_object('application_id', p_application_id, 'direction', 'worker_to_structure')
  );
  perform public.notify(
    v.owner_id, 'rating_request', 'Mission terminée',
    'Comment s''est passée la mission « ' || v.title || ' » avec ton salarié ? Donne ton avis.',
    jsonb_build_object('application_id', p_application_id, 'direction', 'structure_to_worker')
  );
end;
$$;

revoke execute on function private.finalize_mission_end(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Validation / contestation / rejet de l'entree CV.
-- ---------------------------------------------------------------------------
create or replace function public.verify_mission_cv_entry(p_application_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v record;
begin
  select a.id, a.cv_status, m.structure_id
  into v
  from public.applications a
  join public.missions m on m.id = a.mission_id
  where a.id = p_application_id
  for update of a;

  if not found then
    raise exception 'Mission introuvable.';
  end if;
  if not public.can_validate_structure_attendance(v.structure_id) then
    raise exception 'Non autorise.';
  end if;
  if v.cv_status <> 'pending_verification' then
    raise exception 'Cette mission n''est pas en attente de verification.';
  end if;
  if exists (
    select 1 from public.mission_reports r
    where r.application_id = p_application_id
      and r.status in ('open', 'awaiting_response', 'reviewing')
      and r.severity in ('high', 'critical')
  ) then
    raise exception 'Un signalement bloquant doit etre traite avant validation.';
  end if;

  update public.applications
  set cv_status = 'verified', cv_verified_at = now(), cv_status_reason = null
  where id = p_application_id;
end;
$$;

create or replace function public.dispute_mission_cv_entry(p_application_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v record;
begin
  select a.id, a.cv_status, m.structure_id
  into v
  from public.applications a
  join public.missions m on m.id = a.mission_id
  where a.id = p_application_id
  for update of a;

  if not found then
    raise exception 'Mission introuvable.';
  end if;
  if not public.can_validate_structure_attendance(v.structure_id) then
    raise exception 'Non autorise.';
  end if;
  if v.cv_status not in ('pending_verification', 'verified') then
    raise exception 'Cette mission ne peut pas etre contestee.';
  end if;

  update public.applications
  set cv_status = 'disputed', cv_status_reason = nullif(trim(p_reason), '')
  where id = p_application_id;
end;
$$;

-- Reserve au support UROSI (founder) : rejet definitif avec motif visible.
create or replace function public.reject_mission_cv_entry(p_application_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_founder() then
    raise exception 'Non autorise.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Un motif est requis.';
  end if;

  update public.applications
  set cv_status = 'rejected', cv_status_reason = trim(p_reason)
  where id = p_application_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Rappel de note ("Me le rappeler plus tard") : ne supprime jamais la
--    demande, avance juste son horodatage/etage de rappel.
-- ---------------------------------------------------------------------------
create or replace function public.snooze_rating_request(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.rating_requests
  set last_reminded_at = now(),
      reminder_stage = least(reminder_stage + 1, 3)
  where id = p_id
    and reviewer_id = auth.uid()
    and status = 'pending';
end;
$$;

revoke execute on function public.verify_mission_cv_entry(uuid) from public, anon;
revoke execute on function public.dispute_mission_cv_entry(uuid, text) from public, anon;
revoke execute on function public.reject_mission_cv_entry(uuid, text) from public, anon;
revoke execute on function public.snooze_rating_request(uuid) from public, anon;
grant execute on function public.verify_mission_cv_entry(uuid) to authenticated;
grant execute on function public.dispute_mission_cv_entry(uuid, text) to authenticated;
grant execute on function public.reject_mission_cv_entry(uuid, text) to authenticated;
grant execute on function public.snooze_rating_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Maintenance planifiee (appelee par l'edge function existante, service
--    role uniquement) : verification automatique passe 48h sans contestation
--    bloquante, publication automatique des notes en attente depuis 7 jours.
-- ---------------------------------------------------------------------------
create or replace function public.auto_verify_ready_missions()
returns table(application_id uuid, outcome text)
language plpgsql security definer set search_path = public
as $$
declare
  v_app record;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Execution reservee au backend UROSI.';
  end if;

  for v_app in
    select a.id
    from public.applications a
    where a.cv_status = 'pending_verification'
      and a.actual_end_at is not null
      and a.actual_end_at <= now() - interval '48 hours'
      and not exists (
        select 1 from public.mission_reports r
        where r.application_id = a.id
          and r.status in ('open', 'awaiting_response', 'reviewing')
          and r.severity in ('high', 'critical')
      )
    limit 500
  loop
    update public.applications
    set cv_status = 'verified', cv_verified_at = now()
    where id = v_app.id;
    application_id := v_app.id;
    outcome := 'verified';
    return next;
  end loop;
  return;
end;
$$;

create or replace function public.auto_publish_stale_ratings()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Execution reservee au backend UROSI.';
  end if;

  update public.ratings
  set status = 'published'
  where status = 'pending'
    and created_at <= now() - interval '7 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.auto_verify_ready_missions() from public, anon, authenticated;
revoke execute on function public.auto_publish_stale_ratings() from public, anon, authenticated;
grant execute on function public.auto_verify_ready_missions() to service_role;
grant execute on function public.auto_publish_stale_ratings() to service_role;

-- ---------------------------------------------------------------------------
-- 8. Messagerie : fermee automatiquement a la fin de mission
--    (conversation_status, mis a jour par finalize_mission_end). Corrige au
--    passage un ecart existant : les statuts 'in_progress'/'payment_pending'
--    n'autorisaient deja plus l'envoi cote RLS alors que le bouton restait
--    visible cote front (cf. changements WorkerApp/StructureApp).
-- ---------------------------------------------------------------------------
drop policy if exists "messages: participants write" on public.messages;
create policy "messages: participants write"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and public.can_access_application(application_id)
    and exists (
      select 1 from public.applications a
      where a.id = application_id
        and a.conversation_status = 'open'
        and a.status not in ('rejected', 'cancelled')
    )
  );
