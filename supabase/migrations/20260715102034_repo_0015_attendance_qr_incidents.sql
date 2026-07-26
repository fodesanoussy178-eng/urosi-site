-- 0015 : pointage debut/fin par QR, retards, absences, preuves et incidents.
-- Les QR ne contiennent aucune donnee personnelle : uniquement un jeton
-- aleatoire temporaire. En base, seul le hash du jeton est conserve.

-- ---------------------------------------------------------------------------
-- Statuts et colonnes de presence sur applications.
-- ---------------------------------------------------------------------------
alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications
  add constraint applications_status_check
  check (status in (
    'pending', 'accepted', 'in_progress', 'payment_pending',
    'rejected', 'cancelled', 'completed', 'disputed'
  ));

alter table public.applications add column if not exists scheduled_start_at timestamptz;
alter table public.applications add column if not exists scheduled_end_at timestamptz;
alter table public.applications add column if not exists actual_start_at timestamptz;
alter table public.applications add column if not exists actual_end_at timestamptz;
alter table public.applications add column if not exists attendance_status text not null default 'not_started'
  check (attendance_status in ('not_started', 'start_confirmed', 'end_confirmed', 'remote_pending', 'paper_pending', 'disputed'));
alter table public.applications add column if not exists attendance_method_start text
  check (attendance_method_start in ('qr', 'remote', 'paper', 'support'));
alter table public.applications add column if not exists attendance_method_end text
  check (attendance_method_end in ('qr', 'remote', 'paper', 'support'));
alter table public.applications add column if not exists start_validated_by uuid references public.profiles (id) on delete set null;
alter table public.applications add column if not exists end_validated_by uuid references public.profiles (id) on delete set null;
alter table public.applications add column if not exists delay_minutes integer not null default 0 check (delay_minutes >= 0);
alter table public.applications add column if not exists delay_status text not null default 'on_time'
  check (delay_status in ('on_time', 'tolerated', 'late', 'disputed', 'justified'));
alter table public.applications add column if not exists delay_reason text;
alter table public.applications add column if not exists delay_reported_by uuid references public.profiles (id) on delete set null;
alter table public.applications add column if not exists delay_confirmed_by uuid references public.profiles (id) on delete set null;
alter table public.applications add column if not exists payment_ready_at timestamptz;

create index if not exists applications_attendance_status_idx on public.applications (attendance_status);
create index if not exists applications_payment_ready_at_idx on public.applications (payment_ready_at);

-- Le travailleur peut annuler sa candidature, mais la fin de mission doit
-- etre confirmee par la structure, le papier ou le support.
drop policy if exists "applications: worker cancel own" on public.applications;
drop policy if exists "applications: worker cancel or complete own" on public.applications;
create policy "applications: worker cancel own"
  on public.applications for update
  using (worker_id = auth.uid())
  with check (worker_id = auth.uid() and status in ('pending', 'cancelled'));

create or replace function public.mission_schedule_bounds(p_mission_id uuid)
returns table(start_at timestamptz, end_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select
    (
      m.scheduled_date::text || ' ' || coalesce(m.start_time::text, '00:00')
    )::timestamp at time zone 'Europe/Paris' as start_at,
    (
      (
        m.scheduled_date::text || ' ' || coalesce(m.start_time::text, '00:00')
      )::timestamp at time zone 'Europe/Paris'
    ) + make_interval(mins => m.duration_minutes) as end_at
  from public.missions m
  where m.id = p_mission_id;
$$;

create or replace function public.applications_apply_schedule()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  select b.start_at, b.end_at into v_start, v_end
  from public.mission_schedule_bounds(new.mission_id) b;

  new.scheduled_start_at := coalesce(new.scheduled_start_at, v_start);
  new.scheduled_end_at := coalesce(new.scheduled_end_at, v_end);
  return new;
end;
$$;

drop trigger if exists applications_apply_schedule on public.applications;
create trigger applications_apply_schedule
  before insert or update of mission_id on public.applications
  for each row execute function public.applications_apply_schedule();

update public.applications a
set scheduled_start_at = coalesce(
      a.scheduled_start_at,
      (m.scheduled_date::text || ' ' || coalesce(m.start_time::text, '00:00'))::timestamp at time zone 'Europe/Paris'
    ),
    scheduled_end_at = coalesce(
      a.scheduled_end_at,
      ((m.scheduled_date::text || ' ' || coalesce(m.start_time::text, '00:00'))::timestamp at time zone 'Europe/Paris')
        + make_interval(mins => m.duration_minutes)
    ),
    actual_start_at = coalesce(a.actual_start_at, a.checked_in_at),
    attendance_status = case
      when a.actual_end_at is not null then 'end_confirmed'
      when coalesce(a.actual_start_at, a.checked_in_at) is not null then 'start_confirmed'
      else a.attendance_status
    end
from public.missions m
where m.id = a.mission_id
  and (
    a.scheduled_start_at is null
    or a.scheduled_end_at is null
    or (a.actual_start_at is null and a.checked_in_at is not null)
  );

-- ---------------------------------------------------------------------------
-- Membres structure autorises a valider le pointage.
-- ---------------------------------------------------------------------------
create table if not exists public.structure_members (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'manager', 'member')),
  can_validate_attendance boolean not null default false,
  created_at timestamptz not null default now(),
  unique (structure_id, user_id)
);

create index if not exists structure_members_user_id_idx on public.structure_members (user_id);
alter table public.structure_members enable row level security;

create or replace function public.can_validate_structure_attendance(_structure_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.structures s
    where s.id = _structure_id and s.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.structure_members sm
    where sm.structure_id = _structure_id
      and sm.user_id = auth.uid()
      and sm.can_validate_attendance
  );
$$;

drop policy if exists "structure_members: owner or self read" on public.structure_members;
create policy "structure_members: owner or self read"
  on public.structure_members for select
  using (user_id = auth.uid() or public.is_structure_owner(structure_id));

drop policy if exists "structure_members: owner manages" on public.structure_members;
create policy "structure_members: owner manages"
  on public.structure_members for all
  using (public.is_structure_owner(structure_id))
  with check (public.is_structure_owner(structure_id));

-- ---------------------------------------------------------------------------
-- Tables de pointage, preuves, incidents et fiabilite atomique.
-- ---------------------------------------------------------------------------
create table if not exists public.mission_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  worker_id uuid not null references public.profiles (id) on delete cascade,
  structure_id uuid not null references public.structures (id) on delete cascade,
  type text not null check (type in ('start', 'end')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mission_qr_tokens_application_type_idx on public.mission_qr_tokens (application_id, type, created_at desc);
create index if not exists mission_qr_tokens_expires_idx on public.mission_qr_tokens (expires_at);
alter table public.mission_qr_tokens enable row level security;

create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  worker_id uuid not null references public.profiles (id) on delete cascade,
  structure_id uuid not null references public.structures (id) on delete cascade,
  event_type text not null check (event_type in (
    'start_requested', 'start_confirmed', 'end_requested', 'end_confirmed',
    'delay_reported', 'delay_confirmed', 'absence_reported', 'absence_confirmed',
    'issue_reported', 'remote_requested', 'paper_submitted'
  )),
  method text not null check (method in ('qr', 'remote', 'paper', 'support')),
  validated_by uuid references public.profiles (id) on delete set null,
  declared_time timestamptz,
  confirmed_time timestamptz,
  evidence_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists attendance_events_application_created_idx on public.attendance_events (application_id, created_at);
alter table public.attendance_events enable row level security;

create table if not exists public.attendance_evidence (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  file_path text not null,
  method text not null check (method in ('paper', 'other')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'disputed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null
);

create index if not exists attendance_evidence_application_idx on public.attendance_evidence (application_id);
alter table public.attendance_evidence enable row level security;

create table if not exists public.mission_reports (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  application_id uuid references public.applications (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_user_id uuid references public.profiles (id) on delete set null,
  structure_id uuid not null references public.structures (id) on delete cascade,
  category text not null,
  description text,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'awaiting_response', 'reviewing', 'resolved', 'rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);

create index if not exists mission_reports_application_idx on public.mission_reports (application_id);
create index if not exists mission_reports_structure_status_idx on public.mission_reports (structure_id, status);
alter table public.mission_reports enable row level security;

create table if not exists public.mission_report_evidence (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.mission_reports (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  file_path text not null,
  mime_type text,
  created_at timestamptz not null default now()
);

alter table public.mission_report_evidence enable row level security;

create table if not exists public.reliability_events (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('worker', 'structure')),
  subject_id uuid not null,
  mission_id uuid references public.missions (id) on delete cascade,
  application_id uuid references public.applications (id) on delete cascade,
  event_type text not null check (event_type in (
    'presence_confirmed', 'mission_completed', 'delay_reported', 'delay_confirmed',
    'absence_reported', 'absence_confirmed', 'early_departure_reported',
    'mission_disputed', 'report_opened', 'report_resolved'
  )),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'disputed', 'dismissed')),
  source text not null default 'system' check (source in ('system', 'qr', 'remote', 'paper', 'support')),
  weight integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists reliability_events_subject_idx on public.reliability_events (subject_type, subject_id, created_at desc);
alter table public.reliability_events enable row level security;

drop policy if exists "attendance_events: participants read" on public.attendance_events;
create policy "attendance_events: participants read"
  on public.attendance_events for select
  using (public.can_access_application(application_id));

drop policy if exists "attendance_evidence: participants read" on public.attendance_evidence;
create policy "attendance_evidence: participants read"
  on public.attendance_evidence for select
  using (public.can_access_application(application_id));

drop policy if exists "attendance_evidence: participants create" on public.attendance_evidence;
create policy "attendance_evidence: participants create"
  on public.attendance_evidence for insert
  with check (uploaded_by = auth.uid() and public.can_access_application(application_id));

drop policy if exists "mission_reports: participants read" on public.mission_reports;
create policy "mission_reports: participants read"
  on public.mission_reports for select
  using (
    reporter_id = auth.uid()
    or (application_id is not null and public.can_access_application(application_id))
    or public.is_structure_owner(structure_id)
  );

drop policy if exists "mission_reports: participants create" on public.mission_reports;
create policy "mission_reports: participants create"
  on public.mission_reports for insert
  with check (
    reporter_id = auth.uid()
    and (
      (application_id is not null and public.can_access_application(application_id))
      or public.is_structure_owner(structure_id)
    )
  );

drop policy if exists "mission_report_evidence: participants read" on public.mission_report_evidence;
create policy "mission_report_evidence: participants read"
  on public.mission_report_evidence for select
  using (
    exists (
      select 1 from public.mission_reports r
      where r.id = report_id
        and (
          r.reporter_id = auth.uid()
          or (r.application_id is not null and public.can_access_application(r.application_id))
          or public.is_structure_owner(r.structure_id)
        )
    )
  );

drop policy if exists "mission_report_evidence: participants create" on public.mission_report_evidence;
create policy "mission_report_evidence: participants create"
  on public.mission_report_evidence for insert
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.mission_reports r
      where r.id = report_id
        and (
          r.reporter_id = auth.uid()
          or (r.application_id is not null and public.can_access_application(r.application_id))
          or public.is_structure_owner(r.structure_id)
        )
    )
  );

drop policy if exists "reliability_events: subject or participant read" on public.reliability_events;
create policy "reliability_events: subject or participant read"
  on public.reliability_events for select
  using (
    (subject_type = 'worker' and subject_id = auth.uid())
    or (subject_type = 'structure' and public.is_structure_owner(subject_id))
    or (application_id is not null and public.can_access_application(application_id))
  );

-- Bucket prive pour photos d'attestation et preuves d'incident.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attendance-evidence',
  'attendance-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Helpers et RPC securisees.
-- ---------------------------------------------------------------------------
create or replace function public.safe_worker_name(p_full_name text)
returns text
language plpgsql immutable
as $$
declare
  parts text[];
begin
  parts := regexp_split_to_array(trim(coalesce(p_full_name, '')), '\s+');
  if array_length(parts, 1) is null then
    return 'Travailleur';
  end if;
  if array_length(parts, 1) = 1 then
    return parts[1];
  end if;
  return parts[1] || ' ' || left(parts[2], 1) || '.';
end;
$$;

create or replace function public.create_mission_qr_token(
  p_application_id uuid,
  p_type text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_app record;
  v_token text;
  v_hash text;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if auth.uid() is null then
    raise exception 'Non autorise.';
  end if;
  if p_type not in ('start', 'end') then
    raise exception 'Type de QR invalide.';
  end if;

  select a.*, m.structure_id, m.id as mission_id
  into v_app
  from public.applications a
  join public.missions m on m.id = a.mission_id
  where a.id = p_application_id
    and a.worker_id = auth.uid();

  if not found then
    raise exception 'Mission introuvable.';
  end if;
  if v_app.status not in ('accepted', 'in_progress', 'payment_pending') then
    raise exception 'Le QR est disponible uniquement pour une mission acceptee.';
  end if;
  if p_type = 'start' and v_app.actual_start_at is not null then
    raise exception 'Le debut de mission est deja confirme.';
  end if;
  if p_type = 'end' and v_app.actual_start_at is null then
    raise exception 'La fin ne peut pas etre validee avant le debut.';
  end if;
  if p_type = 'end' and v_app.actual_end_at is not null then
    raise exception 'La fin de mission est deja confirmee.';
  end if;

  update public.mission_qr_tokens
  set used_at = now()
  where application_id = p_application_id
    and type = p_type
    and used_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  insert into public.mission_qr_tokens (
    mission_id, application_id, worker_id, structure_id, type, token_hash, expires_at
  ) values (
    v_app.mission_id, v_app.id, v_app.worker_id, v_app.structure_id, p_type, v_hash, v_expires
  );

  insert into public.attendance_events (
    mission_id, application_id, worker_id, structure_id, event_type, method, declared_time
  ) values (
    v_app.mission_id, v_app.id, v_app.worker_id, v_app.structure_id,
    case when p_type = 'start' then 'start_requested' else 'end_requested' end,
    'qr',
    now()
  );

  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end;
$$;

create or replace function public.get_scan_context(p_token text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_hash text := encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  v record;
  v_authorized boolean;
  v_state text := 'valid';
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;

  select t.id as token_id, t.type, t.expires_at, t.used_at,
         a.id as application_id, a.worker_id, a.status as application_status,
         a.scheduled_start_at, a.scheduled_end_at, a.actual_start_at, a.actual_end_at,
         a.delay_minutes, a.delay_status,
         m.id as mission_id, m.title as mission_title, m.city, m.scheduled_date,
         m.start_time, m.duration_minutes, m.slots,
         s.id as structure_id, s.name as structure_name,
         p.full_name as worker_full_name
  into v
  from public.mission_qr_tokens t
  join public.applications a on a.id = t.application_id
  join public.missions m on m.id = t.mission_id
  join public.structures s on s.id = t.structure_id
  join public.profiles p on p.id = t.worker_id
  where t.token_hash = v_hash;

  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  v_authorized := public.can_validate_structure_attendance(v.structure_id);
  if v.used_at is not null then
    v_state := 'used';
  elsif v.expires_at <= now() then
    v_state := 'expired';
  elsif not v_authorized then
    v_state := 'not_authorized';
  elsif v.type = 'end' and v.actual_start_at is null then
    v_state := 'missing_start';
  elsif v.type = 'start' and v.actual_start_at is not null then
    v_state := 'already_started';
  elsif v.type = 'end' and v.actual_end_at is not null then
    v_state := 'already_ended';
  end if;

  return jsonb_build_object(
    'state', v_state,
    'type', v.type,
    'expires_at', v.expires_at,
    'application_id', v.application_id,
    'mission_id', v.mission_id,
    'mission_title', v.mission_title,
    'city', v.city,
    'scheduled_date', v.scheduled_date,
    'start_time', v.start_time,
    'duration_minutes', v.duration_minutes,
    'scheduled_start_at', v.scheduled_start_at,
    'scheduled_end_at', v.scheduled_end_at,
    'actual_start_at', v.actual_start_at,
    'actual_end_at', v.actual_end_at,
    'delay_minutes', v.delay_minutes,
    'delay_status', v.delay_status,
    'worker_name', public.safe_worker_name(v.worker_full_name),
    'structure_name', v.structure_name,
    'current_time', now()
  );
end;
$$;

create or replace function public.confirm_attendance_qr(p_token text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_hash text := encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  v record;
  v_now timestamptz := now();
  v_delay integer := 0;
  v_delay_status text := 'on_time';
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;

  select t.id as token_id, t.type, t.expires_at, t.used_at,
         a.id as application_id, a.worker_id, a.status as application_status,
         a.scheduled_start_at, a.scheduled_end_at, a.actual_start_at, a.actual_end_at,
         m.id as mission_id, m.title as mission_title, m.structure_id,
         s.owner_id
  into v
  from public.mission_qr_tokens t
  join public.applications a on a.id = t.application_id
  join public.missions m on m.id = t.mission_id
  join public.structures s on s.id = t.structure_id
  where t.token_hash = v_hash
  for update of t, a;

  if not found then
    raise exception 'QR invalide.';
  end if;
  if not public.can_validate_structure_attendance(v.structure_id) then
    raise exception 'Ce compte ne peut pas valider le pointage de cette structure.';
  end if;
  if v.used_at is not null then
    raise exception 'QR deja utilise.';
  end if;
  if v.expires_at <= now() then
    raise exception 'QR expire.';
  end if;

  if v.type = 'start' then
    if v.actual_start_at is not null then
      raise exception 'Debut deja confirme.';
    end if;

    v_delay := greatest(floor(extract(epoch from (v_now - coalesce(v.scheduled_start_at, v_now))) / 60)::int, 0);
    v_delay_status := case
      when v_delay = 0 then 'on_time'
      when v_delay <= 5 then 'tolerated'
      else 'late'
    end;

    update public.applications
    set actual_start_at = v_now,
        checked_in_at = coalesce(checked_in_at, v_now),
        start_validated_by = auth.uid(),
        attendance_method_start = 'qr',
        attendance_status = 'start_confirmed',
        delay_minutes = v_delay,
        delay_status = v_delay_status,
        delay_confirmed_by = auth.uid(),
        status = 'in_progress'
    where id = v.application_id;

    insert into public.attendance_events (
      mission_id, application_id, worker_id, structure_id, event_type, method,
      validated_by, confirmed_time, note
    ) values (
      v.mission_id, v.application_id, v.worker_id, v.structure_id,
      'start_confirmed', 'qr', auth.uid(), v_now,
      case when v_delay > 0 then 'Retard calcule : ' || v_delay || ' min' else null end
    );

    insert into public.reliability_events (
      subject_type, subject_id, mission_id, application_id, event_type, status, source, metadata
    ) values (
      'worker', v.worker_id, v.mission_id, v.application_id,
      'presence_confirmed', 'confirmed', 'qr',
      jsonb_build_object('delay_minutes', v_delay, 'delay_status', v_delay_status)
    );

    if v_delay > 5 then
      insert into public.reliability_events (
        subject_type, subject_id, mission_id, application_id, event_type, status, source, metadata
      ) values (
        'worker', v.worker_id, v.mission_id, v.application_id,
        'delay_confirmed', 'pending', 'qr',
        jsonb_build_object('delay_minutes', v_delay, 'delay_status', v_delay_status)
      );
    end if;

    perform public.notify(
      v.worker_id, 'attendance_start',
      'Debut confirme',
      'Debut de mission confirme a ' || to_char(v_now at time zone 'Europe/Paris', 'HH24:MI') || ' pour « ' || v.mission_title || ' ».',
      jsonb_build_object('application_id', v.application_id, 'mission_id', v.mission_id, 'confirmed_at', v_now, 'delay_minutes', v_delay)
    );
  else
    if v.actual_start_at is null then
      raise exception 'La fin ne peut pas etre validee avant le debut.';
    end if;
    if v.actual_end_at is not null then
      raise exception 'Fin deja confirmee.';
    end if;

    update public.applications
    set actual_end_at = v_now,
        end_validated_by = auth.uid(),
        attendance_method_end = 'qr',
        attendance_status = 'end_confirmed',
        status = 'payment_pending',
        payment_ready_at = v_now + interval '3 days'
    where id = v.application_id;

    insert into public.attendance_events (
      mission_id, application_id, worker_id, structure_id, event_type, method,
      validated_by, confirmed_time
    ) values (
      v.mission_id, v.application_id, v.worker_id, v.structure_id,
      'end_confirmed', 'qr', auth.uid(), v_now
    );

    insert into public.reliability_events (
      subject_type, subject_id, mission_id, application_id, event_type, status, source, metadata
    ) values (
      'worker', v.worker_id, v.mission_id, v.application_id,
      'mission_completed', 'confirmed', 'qr',
      jsonb_build_object('actual_end_at', v_now, 'payment_ready_at', v_now + interval '3 days')
    );

    perform public.notify(
      v.worker_id, 'attendance_end',
      'Fin confirmee',
      'Fin de mission confirmee. Le paiement est prepare pour J+3.',
      jsonb_build_object('application_id', v.application_id, 'mission_id', v.mission_id, 'confirmed_at', v_now, 'payment_ready_at', v_now + interval '3 days')
    );
  end if;

  update public.mission_qr_tokens
  set used_at = v_now
  where id = v.token_id;

  return jsonb_build_object(
    'state', 'confirmed',
    'type', v.type,
    'application_id', v.application_id,
    'mission_id', v.mission_id,
    'confirmed_at', v_now
  );
end;
$$;

create or replace function public.request_remote_attendance(
  p_application_id uuid,
  p_type text,
  p_reason text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v record;
  v_event uuid;
begin
  if p_type not in ('start', 'end') then
    raise exception 'Type de validation invalide.';
  end if;

  select a.id, a.worker_id, m.id as mission_id, m.title, m.structure_id, s.owner_id
  into v
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = p_application_id
    and a.worker_id = auth.uid()
    and a.status in ('accepted', 'in_progress');

  if not found then
    raise exception 'Mission introuvable.';
  end if;

  insert into public.attendance_events (
    mission_id, application_id, worker_id, structure_id, event_type, method,
    declared_time, note
  ) values (
    v.mission_id, v.id, v.worker_id, v.structure_id,
    case when p_type = 'start' then 'start_requested' else 'end_requested' end,
    'remote', now(), nullif(p_reason, '')
  )
  returning id into v_event;

  update public.applications
  set attendance_status = 'remote_pending'
  where id = v.id;

  perform public.notify(
    v.owner_id, 'attendance_remote',
    'Validation a distance demandee',
    'Le travailleur demande une validation ' || case when p_type = 'start' then 'du debut' else 'de la fin' end || ' pour « ' || v.title || ' ».',
    jsonb_build_object('application_id', v.id, 'mission_id', v.mission_id, 'event_id', v_event, 'type', p_type)
  );

  return v_event;
end;
$$;

create or replace function public.confirm_remote_attendance(
  p_application_id uuid,
  p_type text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v record;
  v_now timestamptz := now();
begin
  if p_type not in ('start', 'end') then
    raise exception 'Type de validation invalide.';
  end if;

  select a.*, m.id as mission_id, m.title, m.structure_id
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

  if p_type = 'start' then
    if v.actual_start_at is not null then
      raise exception 'Debut deja confirme.';
    end if;
    update public.applications
    set actual_start_at = v_now,
        checked_in_at = coalesce(checked_in_at, v_now),
        start_validated_by = auth.uid(),
        attendance_method_start = 'remote',
        attendance_status = 'start_confirmed',
        status = 'in_progress'
    where id = p_application_id;
  else
    if v.actual_start_at is null then
      raise exception 'La fin ne peut pas etre validee avant le debut.';
    end if;
    update public.applications
    set actual_end_at = v_now,
        end_validated_by = auth.uid(),
        attendance_method_end = 'remote',
        attendance_status = 'end_confirmed',
        status = 'payment_pending',
        payment_ready_at = v_now + interval '3 days'
    where id = p_application_id;
  end if;

  insert into public.attendance_events (
    mission_id, application_id, worker_id, structure_id, event_type, method,
    validated_by, confirmed_time
  ) values (
    v.mission_id, p_application_id, v.worker_id, v.structure_id,
    case when p_type = 'start' then 'start_confirmed' else 'end_confirmed' end,
    'remote', auth.uid(), v_now
  );

  perform public.notify(
    v.worker_id, 'attendance_remote_confirmed',
    'Validation a distance confirmee',
    case when p_type = 'start' then 'Debut' else 'Fin' end || ' confirme(e) pour « ' || v.title || ' ».',
    jsonb_build_object('application_id', p_application_id, 'mission_id', v.mission_id, 'type', p_type, 'confirmed_at', v_now)
  );

  return jsonb_build_object('application_id', p_application_id, 'type', p_type, 'confirmed_at', v_now);
end;
$$;

alter table public.delay_notices add column if not exists reason text;
alter table public.delay_notices add column if not exists estimated_arrival_at timestamptz;
alter table public.delay_notices add column if not exists acknowledged_at timestamptz;
alter table public.delay_notices add column if not exists structure_response text
  check (structure_response in ('acknowledged', 'accepted_delay', 'need_precision', 'mission_at_risk'));

create or replace function public.report_worker_delay(
  p_application_id uuid,
  p_minutes integer,
  p_reason text default null,
  p_eta timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v record;
  v_notice uuid;
begin
  if p_minutes <= 0 or p_minutes > 240 then
    raise exception 'Duree de retard invalide.';
  end if;

  select a.id, a.worker_id, m.id as mission_id, m.title, m.structure_id, s.owner_id
  into v
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = p_application_id
    and a.worker_id = auth.uid()
    and a.status in ('accepted', 'in_progress');

  if not found then
    raise exception 'Mission introuvable.';
  end if;

  insert into public.delay_notices (application_id, minutes, reason, estimated_arrival_at)
  values (p_application_id, p_minutes, nullif(p_reason, ''), p_eta)
  returning id into v_notice;

  update public.applications
  set delay_reason = coalesce(nullif(p_reason, ''), delay_reason),
      delay_reported_by = auth.uid()
  where id = p_application_id;

  insert into public.attendance_events (
    mission_id, application_id, worker_id, structure_id, event_type, method,
    declared_time, note
  ) values (
    v.mission_id, p_application_id, v.worker_id, v.structure_id,
    'delay_reported', 'support', now(), nullif(p_reason, '')
  );

  insert into public.reliability_events (
    subject_type, subject_id, mission_id, application_id, event_type, status, source, metadata
  ) values (
    'worker', v.worker_id, v.mission_id, p_application_id,
    'delay_reported', 'pending', 'system',
    jsonb_build_object('minutes', p_minutes, 'reason', p_reason, 'estimated_arrival_at', p_eta)
  );

  return v_notice;
end;
$$;

create or replace function public.report_mission_issue(
  p_application_id uuid,
  p_category text,
  p_description text default null,
  p_severity text default 'medium',
  p_reported_user_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v record;
  v_report uuid;
  v_target uuid;
begin
  if p_severity not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Gravite invalide.';
  end if;

  select a.id, a.worker_id, m.id as mission_id, m.title, m.structure_id, s.owner_id
  into v
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = p_application_id;

  if not found or not public.can_access_application(p_application_id) then
    raise exception 'Mission introuvable.';
  end if;

  insert into public.mission_reports (
    mission_id, application_id, reporter_id, reported_user_id, structure_id,
    category, description, severity, status
  ) values (
    v.mission_id, v.id, auth.uid(), p_reported_user_id, v.structure_id,
    p_category, nullif(p_description, ''), p_severity,
    case when p_category in ('worker_absent', 'structure_absent') then 'awaiting_response' else 'open' end
  )
  returning id into v_report;

  insert into public.attendance_events (
    mission_id, application_id, worker_id, structure_id, event_type, method,
    declared_time, note
  ) values (
    v.mission_id, v.id, v.worker_id, v.structure_id,
    case when p_category in ('worker_absent', 'structure_absent') then 'absence_reported' else 'issue_reported' end,
    'support', now(), p_category || coalesce(' - ' || nullif(p_description, ''), '')
  );

  insert into public.reliability_events (
    subject_type, subject_id, mission_id, application_id, event_type, status, source, metadata
  ) values (
    case when auth.uid() = v.worker_id then 'structure' else 'worker' end,
    case when auth.uid() = v.worker_id then v.structure_id else v.worker_id end,
    v.mission_id, v.id,
    case when p_category in ('worker_absent', 'structure_absent') then 'absence_reported' else 'report_opened' end,
    'pending', 'support',
    jsonb_build_object('report_id', v_report, 'category', p_category, 'severity', p_severity)
  );

  v_target := case when auth.uid() = v.worker_id then v.owner_id else v.worker_id end;
  perform public.notify(
    v_target, 'mission_report',
    'Signalement mission',
    'Un signalement a ete ouvert sur « ' || v.title || ' ». Interlocuteur : Support UROSI.',
    jsonb_build_object('application_id', v.id, 'mission_id', v.mission_id, 'report_id', v_report, 'category', p_category)
  );

  return v_report;
end;
$$;

create or replace function public.report_worker_absence(
  p_application_id uuid,
  p_reason text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v record;
begin
  select a.id, a.scheduled_start_at, m.structure_id
  into v
  from public.applications a
  join public.missions m on m.id = a.mission_id
  where a.id = p_application_id;

  if not found then
    raise exception 'Mission introuvable.';
  end if;
  if not public.can_validate_structure_attendance(v.structure_id) then
    raise exception 'Non autorise.';
  end if;
  if now() < coalesce(v.scheduled_start_at, now()) + interval '5 minutes' then
    raise exception 'Le signalement d''absence sera disponible apres l''heure prevue et le delai de tolerance.';
  end if;

  return public.report_mission_issue(
    p_application_id,
    'worker_absent',
    coalesce(nullif(p_reason, ''), 'absence signalee par la structure'),
    'high',
    null
  );
end;
$$;

-- Fonction volontairement manuelle : le support ou un job planifie pourra
-- liberer le paiement a J+3 sans que le front modifie un score ou un wallet.
create or replace function public.release_payment_ready_mission(p_application_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_app record;
begin
  select a.id, a.status, a.payment_ready_at, a.worker_id, s.owner_id
  into v_app
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = p_application_id;

  if not found then
    raise exception 'Mission introuvable.';
  end if;
  if auth.uid() not in (v_app.worker_id, v_app.owner_id) and not public.is_founder() then
    raise exception 'Non autorise.';
  end if;
  if v_app.status <> 'payment_pending' or v_app.payment_ready_at > now() then
    raise exception 'Paiement pas encore disponible.';
  end if;

  update public.applications set status = 'completed' where id = p_application_id;
  return public.process_mission_payment(p_application_id);
end;
$$;

-- Fonctions RPC : uniquement utilisateurs connectes.
revoke execute on function public.mission_schedule_bounds(uuid) from public, anon, authenticated;
revoke execute on function public.applications_apply_schedule() from public, anon, authenticated;
revoke execute on function public.can_validate_structure_attendance(uuid) from public, anon, authenticated;
revoke execute on function public.safe_worker_name(text) from public, anon, authenticated;

revoke execute on function public.create_mission_qr_token(uuid, text) from public, anon;
revoke execute on function public.get_scan_context(text) from public, anon;
revoke execute on function public.confirm_attendance_qr(text) from public, anon;
revoke execute on function public.request_remote_attendance(uuid, text, text) from public, anon;
revoke execute on function public.confirm_remote_attendance(uuid, text) from public, anon;
revoke execute on function public.report_worker_delay(uuid, integer, text, timestamptz) from public, anon;
revoke execute on function public.report_mission_issue(uuid, text, text, text, uuid) from public, anon;
revoke execute on function public.report_worker_absence(uuid, text) from public, anon;
revoke execute on function public.release_payment_ready_mission(uuid) from public, anon;

grant execute on function public.create_mission_qr_token(uuid, text) to authenticated;
grant execute on function public.get_scan_context(text) to authenticated;
grant execute on function public.confirm_attendance_qr(text) to authenticated;
grant execute on function public.request_remote_attendance(uuid, text, text) to authenticated;
grant execute on function public.confirm_remote_attendance(uuid, text) to authenticated;
grant execute on function public.report_worker_delay(uuid, integer, text, timestamptz) to authenticated;
grant execute on function public.report_mission_issue(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.report_worker_absence(uuid, text) to authenticated;
grant execute on function public.release_payment_ready_mission(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.attendance_events;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.mission_reports;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
