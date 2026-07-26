-- 0008 : messagerie temps reel + notifications.
--
-- - messages : fil de discussion par candidature (travailleur <-> structure),
--   ouvert des que la candidature est acceptee.
-- - notifications : boite de reception par profil, alimentee par triggers
--   (candidature, decision, mission terminee, note recue, message, retard).
-- - Les deux tables sont publiees sur supabase_realtime (RLS respectee).

-- ---------------------------------------------------------------------------
-- Helper : participant d'une candidature (travailleur ou proprietaire de la
-- structure de la mission).
-- ---------------------------------------------------------------------------
create or replace function public.can_access_application(_application_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.applications a
    join public.missions m on m.id = a.mission_id
    join public.structures s on s.id = m.structure_id
    where a.id = _application_id
      and (a.worker_id = auth.uid() or s.owner_id = auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists messages_application_created_idx on public.messages (application_id, created_at);
create index if not exists messages_sender_id_idx on public.messages (sender_id);

alter table public.messages enable row level security;

drop policy if exists "messages: participants read" on public.messages;
create policy "messages: participants read"
  on public.messages for select
  using (public.can_access_application(application_id));

drop policy if exists "messages: participants write" on public.messages;
create policy "messages: participants write"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and public.can_access_application(application_id)
    and exists (
      select 1 from public.applications a
      where a.id = application_id and a.status in ('accepted', 'completed')
    )
  );

-- Le destinataire (pas l'expediteur) peut marquer un message comme lu.
drop policy if exists "messages: recipient marks read" on public.messages;
create policy "messages: recipient marks read"
  on public.messages for update
  using (public.can_access_application(application_id) and sender_id <> auth.uid())
  with check (public.can_access_application(application_id) and sender_id <> auth.uid());

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_profile_created_idx on public.notifications (profile_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own"
  on public.notifications for select
  using (profile_id = auth.uid());

drop policy if exists "notifications: mark own read" on public.notifications;
create policy "notifications: mark own read"
  on public.notifications for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Insertion uniquement via triggers (security definer) : pas de policy INSERT,
-- et la fonction notify n'est pas exposee aux clients.
create or replace function public.notify(
  p_profile_id uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_data jsonb default '{}'::jsonb
)
returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (profile_id, kind, title, body, data)
  values (p_profile_id, p_kind, p_title, p_body, coalesce(p_data, '{}'::jsonb));
$$;

revoke execute on function public.notify(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers de notification
-- ---------------------------------------------------------------------------
create or replace function public.trg_notify_new_application()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
  v_worker text;
begin
  select s.owner_id, m.title into v_owner, v_title
  from public.missions m
  join public.structures s on s.id = m.structure_id
  where m.id = new.mission_id;
  select full_name into v_worker from public.profiles where id = new.worker_id;
  perform public.notify(
    v_owner, 'application',
    'Nouvelle candidature',
    coalesce(nullif(v_worker, ''), 'Un travailleur') || ' a postulé à « ' || v_title || ' ».',
    jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
  );
  return new;
end;
$$;

drop trigger if exists applications_notify_new on public.applications;
create trigger applications_notify_new
  after insert on public.applications
  for each row execute function public.trg_notify_new_application();

create or replace function public.trg_notify_application_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
begin
  if new.status = old.status then
    return new;
  end if;

  select s.owner_id, m.title into v_owner, v_title
  from public.missions m
  join public.structures s on s.id = m.structure_id
  where m.id = new.mission_id;

  if new.status = 'accepted' then
    perform public.notify(
      new.worker_id, 'application_accepted',
      'Candidature acceptée 🎉',
      'Tu es retenu·e pour « ' || v_title || ' ». Le fil de discussion est ouvert.',
      jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
    );
  elsif new.status = 'rejected' then
    perform public.notify(
      new.worker_id, 'application_rejected',
      'Candidature non retenue',
      'La structure a choisi un autre profil pour « ' || v_title || ' ».',
      jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
    );
  elsif new.status = 'completed' then
    perform public.notify(
      v_owner, 'mission_completed',
      'Mission terminée',
      '« ' || v_title || ' » est marquée terminée. Pense à noter le travailleur.',
      jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
    );
  elsif new.status = 'cancelled' then
    perform public.notify(
      v_owner, 'application_cancelled',
      'Candidature annulée',
      'Un travailleur s''est désisté sur « ' || v_title || ' ».',
      jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists applications_notify_status on public.applications;
create trigger applications_notify_status
  after update of status on public.applications
  for each row execute function public.trg_notify_application_status();

create or replace function public.trg_notify_rating()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
begin
  if new.direction = 'worker_to_structure' then
    select owner_id into v_owner from public.structures where id = new.structure_id;
    perform public.notify(
      v_owner, 'rating',
      'Nouvelle note reçue',
      'Un travailleur a noté ta structure ' || new.score || '/5.',
      jsonb_build_object('application_id', new.application_id, 'score', new.score)
    );
  else
    perform public.notify(
      new.worker_id, 'rating',
      'Nouvelle note sur ton CV vivant',
      'Une structure t''a noté·e ' || new.score || '/5.',
      jsonb_build_object('application_id', new.application_id, 'score', new.score)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists ratings_notify on public.ratings;
create trigger ratings_notify
  after insert on public.ratings
  for each row execute function public.trg_notify_rating();

create or replace function public.trg_notify_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_worker uuid;
  v_owner uuid;
  v_title text;
  v_target uuid;
begin
  select a.worker_id, s.owner_id, m.title into v_worker, v_owner, v_title
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = new.application_id;

  v_target := case when new.sender_id = v_worker then v_owner else v_worker end;
  perform public.notify(
    v_target, 'message',
    'Nouveau message',
    left(new.body, 120),
    jsonb_build_object('application_id', new.application_id, 'mission_title', v_title)
  );
  return new;
end;
$$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify
  after insert on public.messages
  for each row execute function public.trg_notify_message();

create or replace function public.trg_notify_delay()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
begin
  select s.owner_id, m.title into v_owner, v_title
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = new.application_id;
  perform public.notify(
    v_owner, 'delay',
    'Retard signalé ⏱',
    'Retard d''environ ' || new.minutes || ' min sur « ' || v_title || ' ».',
    jsonb_build_object('application_id', new.application_id, 'minutes', new.minutes)
  );
  return new;
end;
$$;

drop trigger if exists delay_notices_notify on public.delay_notices;
create trigger delay_notices_notify
  after insert on public.delay_notices
  for each row execute function public.trg_notify_delay();

-- ---------------------------------------------------------------------------
-- Realtime : publication des messages et notifications (la RLS s'applique)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.messages;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
