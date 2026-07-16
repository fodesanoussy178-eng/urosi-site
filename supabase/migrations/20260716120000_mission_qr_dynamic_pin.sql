-- Validation de presence UROSI : QR de mission + PIN dynamique.
-- Le QR est un identifiant opaque, jamais une preuve suffisante. Le PIN est
-- emis a un employe autorise, expire en 3 minutes et n'est stocke que hashe.

create extension if not exists pgcrypto;

-- Role applicatif sans acces au reste de l'espace Structure.
alter table public.structure_members
  drop constraint if exists structure_members_role_check;
alter table public.structure_members
  add constraint structure_members_role_check
  check (role in ('owner', 'manager', 'member', 'attendance_validator'));

-- La validation manuelle est un mode de pointage explicite et auditable.
alter table public.applications
  drop constraint if exists applications_attendance_method_start_check;
alter table public.applications
  add constraint applications_attendance_method_start_check
  check (attendance_method_start in ('qr', 'manual', 'remote', 'paper', 'support'));
alter table public.applications
  drop constraint if exists applications_attendance_method_end_check;
alter table public.applications
  add constraint applications_attendance_method_end_check
  check (attendance_method_end in ('qr', 'manual', 'remote', 'paper', 'support'));

alter table public.attendance_events
  drop constraint if exists attendance_events_method_check;
alter table public.attendance_events
  add constraint attendance_events_method_check
  check (method in ('qr', 'manual', 'remote', 'paper', 'support'));

alter table public.reliability_events
  drop constraint if exists reliability_events_source_check;
alter table public.reliability_events
  add constraint reliability_events_source_check
  check (source in ('system', 'qr', 'manual', 'remote', 'paper', 'support'));

create table public.mission_validation_keys (
  mission_id uuid primary key references public.missions(id) on delete cascade,
  structure_id uuid not null references public.structures(id) on delete cascade,
  qr_code uuid not null default gen_random_uuid() unique,
  mission_code text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint mission_validation_keys_code_format
    check (mission_code ~ '^UROSI-[A-Z0-9]{8}$')
);

create index mission_validation_keys_structure_idx
  on public.mission_validation_keys(structure_id, created_at desc);
alter table public.mission_validation_keys enable row level security;

create table public.mission_validation_pins (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  structure_id uuid not null references public.structures(id) on delete cascade,
  step text not null check (step in ('start', 'end')),
  pin_hash text not null,
  issued_to uuid not null references public.profiles(id) on delete restrict,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint mission_validation_pins_expiry check (expires_at > issued_at)
);

create index mission_validation_pins_active_idx
  on public.mission_validation_pins(mission_id, step, issued_at desc);
alter table public.mission_validation_pins enable row level security;

create table public.attendance_validation_attempts (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid references public.missions(id) on delete set null,
  application_id uuid references public.applications(id) on delete set null,
  worker_id uuid not null references public.profiles(id) on delete cascade,
  validator_id uuid references public.profiles(id) on delete set null,
  pin_id uuid references public.mission_validation_pins(id) on delete set null,
  step text not null check (step in ('start', 'end')),
  method text not null check (method in ('qr', 'manual')),
  outcome text not null check (outcome in ('confirmed', 'failed', 'blocked')),
  failure_reason text,
  manual_reason text,
  attempted_at timestamptz not null default now()
);

create index attendance_validation_attempts_rate_limit_idx
  on public.attendance_validation_attempts(worker_id, attempted_at desc)
  where outcome in ('failed', 'blocked');
create index attendance_validation_attempts_mission_idx
  on public.attendance_validation_attempts(mission_id, attempted_at desc);
alter table public.attendance_validation_attempts enable row level security;

-- Ces tables ne sont jamais lues ou ecrites directement par un client.
revoke all on public.mission_validation_keys from public, anon, authenticated;
revoke all on public.mission_validation_pins from public, anon, authenticated;
revoke all on public.attendance_validation_attempts from public, anon, authenticated;

-- Politique de refus explicite : seul le code serveur SECURITY DEFINER passe.
create policy "mission validation keys: server only"
  on public.mission_validation_keys for all to authenticated
  using (false) with check (false);
create policy "mission validation pins: server only"
  on public.mission_validation_pins for all to authenticated
  using (false) with check (false);
create policy "attendance validation attempts: server only"
  on public.attendance_validation_attempts for all to authenticated
  using (false) with check (false);

create or replace function private.ensure_mission_validation_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  loop
    v_code := 'UROSI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.mission_validation_keys(mission_id, structure_id, mission_code)
      values (new.id, new.structure_id, v_code);
      exit;
    exception when unique_violation then
      -- Collision extremement improbable : generer un nouveau code.
    end;
  end loop;
  return new;
end;
$$;

revoke execute on function private.ensure_mission_validation_key()
  from public, anon, authenticated;

drop trigger if exists missions_create_validation_key on public.missions;
create trigger missions_create_validation_key
  after insert on public.missions
  for each row execute function private.ensure_mission_validation_key();

-- Backfill idempotent des missions deja publiees.
do $$
declare
  v_mission record;
  v_code text;
begin
  for v_mission in
    select m.id, m.structure_id
    from public.missions m
    left join public.mission_validation_keys k on k.mission_id = m.id
    where k.mission_id is null
  loop
    loop
      v_code := 'UROSI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      begin
        insert into public.mission_validation_keys(mission_id, structure_id, mission_code)
        values (v_mission.id, v_mission.structure_id, v_code);
        exit;
      exception when unique_violation then
      end;
    end loop;
  end loop;
end;
$$;

create or replace function private.log_attendance_validation_attempt(
  p_mission_id uuid,
  p_application_id uuid,
  p_worker_id uuid,
  p_validator_id uuid,
  p_pin_id uuid,
  p_step text,
  p_method text,
  p_outcome text,
  p_failure_reason text default null,
  p_manual_reason text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.attendance_validation_attempts(
    mission_id, application_id, worker_id, validator_id, pin_id,
    step, method, outcome, failure_reason, manual_reason
  ) values (
    p_mission_id, p_application_id, p_worker_id, p_validator_id, p_pin_id,
    p_step, p_method, p_outcome, p_failure_reason, p_manual_reason
  );
$$;

revoke execute on function private.log_attendance_validation_attempt(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;

-- Vue minimale de l'employe validateur : aucune remuneration ni statistique.
create or replace function public.list_validator_missions()
returns table (
  mission_id uuid,
  structure_id uuid,
  structure_name text,
  title text,
  city text,
  starts_at timestamptz,
  ends_at timestamptz,
  scheduled_date date,
  mission_code text,
  qr_code uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.structure_id, s.name, m.title, m.city,
         m.starts_at, m.ends_at, m.scheduled_date, k.mission_code, k.qr_code
  from public.missions m
  join public.structures s on s.id = m.structure_id
  join public.mission_validation_keys k on k.mission_id = m.id
  where auth.uid() is not null
    and k.revoked_at is null
    and public.can_validate_structure_attendance(m.structure_id)
    and m.status <> 'cancelled'
    and m.scheduled_date between
        ((now() at time zone 'Europe/Paris')::date - 1)
        and ((now() at time zone 'Europe/Paris')::date + 7)
  order by m.scheduled_date, m.starts_at nulls last, m.created_at;
$$;

create or replace function public.get_mission_validation_card(p_mission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;

  select m.id, m.structure_id, m.title, m.city, m.starts_at, m.ends_at,
         m.scheduled_date, s.name as structure_name, k.qr_code, k.mission_code
  into v
  from public.missions m
  join public.structures s on s.id = m.structure_id
  join public.mission_validation_keys k on k.mission_id = m.id
  where m.id = p_mission_id and k.revoked_at is null;

  if not found or not public.can_validate_structure_attendance(v.structure_id) then
    raise exception 'Acces refuse.';
  end if;

  return jsonb_build_object(
    'mission_id', v.id,
    'structure_id', v.structure_id,
    'structure_name', v.structure_name,
    'title', v.title,
    'city', v.city,
    'starts_at', v.starts_at,
    'ends_at', v.ends_at,
    'scheduled_date', v.scheduled_date,
    'qr_code', v.qr_code,
    'mission_code', v.mission_code
  );
end;
$$;

create or replace function public.issue_mission_validation_pin(
  p_mission_id uuid,
  p_step text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission record;
  v_pin text;
  v_pin_id uuid;
  v_expires_at timestamptz := now() + interval '3 minutes';
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_first_day date;
  v_last_day date;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;
  if p_step not in ('start', 'end') then
    raise exception 'Etape invalide.';
  end if;

  select m.id, m.structure_id, m.scheduled_date, m.starts_at, m.ends_at,
         m.status, k.revoked_at
  into v_mission
  from public.missions m
  join public.mission_validation_keys k on k.mission_id = m.id
  where m.id = p_mission_id
  for update of k;

  if not found or not public.can_validate_structure_attendance(v_mission.structure_id) then
    raise exception 'Acces refuse.';
  end if;
  if v_mission.status = 'cancelled' or v_mission.revoked_at is not null then
    raise exception 'Cette mission ne peut plus etre validee.';
  end if;

  v_first_day := coalesce(
    (v_mission.starts_at at time zone 'Europe/Paris')::date,
    v_mission.scheduled_date
  );
  v_last_day := coalesce(
    (v_mission.ends_at at time zone 'Europe/Paris')::date,
    v_first_day
  );
  if v_today < v_first_day or v_today > v_last_day then
    return jsonb_build_object('state', 'not_today', 'first_day', v_first_day, 'last_day', v_last_day);
  end if;

  update public.mission_validation_pins
  set revoked_at = now()
  where mission_id = p_mission_id and step = p_step and revoked_at is null;

  v_pin := lpad((get_byte(extensions.gen_random_bytes(4), 0)::integer * 65536
                 + get_byte(extensions.gen_random_bytes(4), 1)::integer * 256
                 + get_byte(extensions.gen_random_bytes(4), 2)::integer)::text, 6, '0');
  v_pin := right(v_pin, 6);

  insert into public.mission_validation_pins(
    mission_id, structure_id, step, pin_hash, issued_to, expires_at
  ) values (
    p_mission_id, v_mission.structure_id, p_step,
    extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), auth.uid(), v_expires_at
  ) returning id into v_pin_id;

  return jsonb_build_object(
    'state', 'active', 'pin_id', v_pin_id, 'pin', v_pin,
    'step', p_step, 'expires_at', v_expires_at, 'server_time', now()
  );
end;
$$;

-- Le travailleur ne recoit que le contexte de sa propre candidature acceptee.
create or replace function public.get_worker_validation_context(
  p_qr_code text default null,
  p_mission_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
  v_step text;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;

  select m.id as mission_id, m.title, m.city, s.name as structure_name,
         a.id as application_id, a.actual_start_at, a.actual_end_at,
         k.mission_code
  into v
  from public.mission_validation_keys k
  join public.missions m on m.id = k.mission_id
  join public.structures s on s.id = m.structure_id
  join public.applications a on a.mission_id = m.id
  where k.revoked_at is null
    and a.worker_id = auth.uid()
    and a.status in ('accepted', 'in_progress', 'payment_pending')
    and (
      (nullif(trim(coalesce(p_qr_code, '')), '') is not null
       and k.qr_code::text = trim(p_qr_code))
      or
      (nullif(trim(coalesce(p_mission_code, '')), '') is not null
       and k.mission_code = upper(trim(p_mission_code)))
    )
  order by a.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;
  if v.actual_end_at is not null then
    return jsonb_build_object('state', 'already_ended');
  end if;
  v_step := case when v.actual_start_at is null then 'start' else 'end' end;

  return jsonb_build_object(
    'state', 'ready', 'step', v_step, 'mission_id', v.mission_id,
    'application_id', v.application_id, 'title', v.title, 'city', v.city,
    'structure_name', v.structure_name, 'mission_code', v.mission_code
  );
end;
$$;

create or replace function public.validate_mission_attendance(
  p_qr_code text default null,
  p_mission_code text default null,
  p_pin text default null,
  p_step text default null,
  p_manual_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key record;
  v_app record;
  v_pin record;
  v_method text;
  v_failures integer;
  v_now timestamptz := now();
  v_delay integer := 0;
  v_delay_status text := 'on_time';
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;
  if p_step not in ('start', 'end') then
    return jsonb_build_object('state', 'invalid_step');
  end if;

  v_method := case
    when nullif(trim(coalesce(p_qr_code, '')), '') is not null then 'qr'
    else 'manual'
  end;
  if v_method = 'manual' and length(trim(coalesce(p_manual_reason, ''))) < 5 then
    return jsonb_build_object('state', 'manual_reason_required');
  end if;

  select k.mission_id, k.structure_id, k.mission_code
  into v_key
  from public.mission_validation_keys k
  where k.revoked_at is null
    and (
      (v_method = 'qr' and k.qr_code::text = trim(coalesce(p_qr_code, '')))
      or
      (v_method = 'manual' and k.mission_code = upper(trim(coalesce(p_mission_code, ''))))
    );
  if not found then
    return jsonb_build_object('state', 'invalid_identifier');
  end if;

  select a.*, m.title as mission_title, m.structure_id
  into v_app
  from public.applications a
  join public.missions m on m.id = a.mission_id
  where a.mission_id = v_key.mission_id
    and a.worker_id = auth.uid()
    and a.status in ('accepted', 'in_progress', 'payment_pending')
  order by a.created_at desc
  limit 1
  for update of a;
  if not found then
    perform private.log_attendance_validation_attempt(
      v_key.mission_id, null, auth.uid(), null, null, p_step, v_method,
      'failed', 'application_not_found', p_manual_reason
    );
    return jsonb_build_object('state', 'application_not_found');
  end if;

  select count(*) into v_failures
  from public.attendance_validation_attempts x
  where x.worker_id = auth.uid()
    and x.outcome in ('failed', 'blocked')
    and x.attempted_at >= now() - interval '10 minutes';
  if v_failures >= 5 then
    perform private.log_attendance_validation_attempt(
      v_key.mission_id, v_app.id, auth.uid(), null, null, p_step, v_method,
      'blocked', 'too_many_attempts', p_manual_reason
    );
    return jsonb_build_object('state', 'locked', 'retry_after_seconds', 600);
  end if;

  if (p_step = 'start' and v_app.actual_start_at is not null)
     or (p_step = 'end' and v_app.actual_start_at is null)
     or (p_step = 'end' and v_app.actual_end_at is not null) then
    perform private.log_attendance_validation_attempt(
      v_key.mission_id, v_app.id, auth.uid(), null, null, p_step, v_method,
      'failed', 'invalid_attendance_state', p_manual_reason
    );
    return jsonb_build_object('state', 'invalid_attendance_state');
  end if;

  select p.id, p.pin_hash, p.issued_to, p.expires_at
  into v_pin
  from public.mission_validation_pins p
  where p.mission_id = v_key.mission_id
    and p.step = p_step
    and p.revoked_at is null
  order by p.issued_at desc
  limit 1
  for update of p;

  if not found or v_pin.expires_at <= now() then
    perform private.log_attendance_validation_attempt(
      v_key.mission_id, v_app.id, auth.uid(),
      case when found then v_pin.issued_to else null end,
      case when found then v_pin.id else null end,
      p_step, v_method, 'failed', 'pin_expired', p_manual_reason
    );
    return jsonb_build_object('state', 'pin_expired');
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$'
     or extensions.crypt(p_pin, v_pin.pin_hash) <> v_pin.pin_hash then
    perform private.log_attendance_validation_attempt(
      v_key.mission_id, v_app.id, auth.uid(), v_pin.issued_to, v_pin.id,
      p_step, v_method, 'failed', 'invalid_pin', p_manual_reason
    );
    return jsonb_build_object('state', 'invalid_pin', 'remaining_attempts', greatest(4 - v_failures, 0));
  end if;

  if p_step = 'start' then
    v_delay := greatest(
      floor(extract(epoch from (v_now - coalesce(v_app.scheduled_start_at, v_now))) / 60)::int,
      0
    );
    v_delay_status := case
      when v_delay = 0 then 'on_time'
      when v_delay <= 5 then 'tolerated'
      else 'late'
    end;

    update public.applications
    set actual_start_at = v_now,
        checked_in_at = coalesce(checked_in_at, v_now),
        start_validated_by = v_pin.issued_to,
        attendance_method_start = v_method,
        attendance_status = 'start_confirmed',
        delay_minutes = v_delay,
        delay_status = v_delay_status,
        delay_confirmed_by = v_pin.issued_to,
        status = 'in_progress'
    where id = v_app.id;

    insert into public.attendance_events(
      mission_id, application_id, worker_id, structure_id, event_type,
      method, validated_by, confirmed_time, note
    ) values (
      v_key.mission_id, v_app.id, auth.uid(), v_key.structure_id,
      'start_confirmed', v_method, v_pin.issued_to, v_now,
      case when v_method = 'manual' then 'Secours : ' || trim(p_manual_reason)
           when v_delay > 0 then 'Retard calcule : ' || v_delay || ' min' end
    );

    insert into public.reliability_events(
      subject_type, subject_id, mission_id, application_id,
      event_type, status, source, metadata
    ) values (
      'worker', auth.uid(), v_key.mission_id, v_app.id,
      'presence_confirmed', 'confirmed', v_method,
      jsonb_build_object('delay_minutes', v_delay, 'delay_status', v_delay_status)
    );

    perform public.notify(
      auth.uid(), 'attendance_start', 'Debut confirme',
      'Ta mission « ' || v_app.mission_title || ' » a commence a ' ||
        to_char(v_now at time zone 'Europe/Paris', 'HH24:MI') || '.',
      jsonb_build_object('application_id', v_app.id, 'mission_id', v_key.mission_id)
    );
  else
    update public.applications
    set actual_end_at = v_now,
        end_validated_by = v_pin.issued_to,
        attendance_method_end = v_method,
        attendance_status = 'end_confirmed',
        status = 'payment_pending',
        payment_ready_at = v_now + interval '3 days'
    where id = v_app.id;

    insert into public.attendance_events(
      mission_id, application_id, worker_id, structure_id, event_type,
      method, validated_by, confirmed_time, note
    ) values (
      v_key.mission_id, v_app.id, auth.uid(), v_key.structure_id,
      'end_confirmed', v_method, v_pin.issued_to, v_now,
      case when v_method = 'manual' then 'Secours : ' || trim(p_manual_reason) end
    );

    insert into public.reliability_events(
      subject_type, subject_id, mission_id, application_id,
      event_type, status, source, metadata
    ) values (
      'worker', auth.uid(), v_key.mission_id, v_app.id,
      'mission_completed', 'confirmed', v_method,
      jsonb_build_object('actual_end_at', v_now, 'payment_ready_at', v_now + interval '3 days')
    );

    perform public.notify(
      auth.uid(), 'attendance_end', 'Fin confirmee',
      'Ta mission est terminee. Le paiement est prepare pour J+3.',
      jsonb_build_object('application_id', v_app.id, 'mission_id', v_key.mission_id)
    );
  end if;

  perform private.log_attendance_validation_attempt(
    v_key.mission_id, v_app.id, auth.uid(), v_pin.issued_to, v_pin.id,
    p_step, v_method, 'confirmed', null, p_manual_reason
  );

  return jsonb_build_object(
    'state', 'confirmed', 'step', p_step, 'mission_id', v_key.mission_id,
    'application_id', v_app.id, 'confirmed_at', v_now,
    'validated_by', v_pin.issued_to
  );
end;
$$;

-- Gestion des employes validateurs par le proprietaire de la structure.
create or replace function public.list_structure_validators(p_structure_id uuid)
returns table(user_id uuid, full_name text, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_structure_owner(p_structure_id) then
    raise exception 'Acces refuse.';
  end if;
  return query
    select sm.user_id, p.full_name, u.email::text, sm.created_at
    from public.structure_members sm
    join public.profiles p on p.id = sm.user_id
    join auth.users u on u.id = sm.user_id
    where sm.structure_id = p_structure_id
      and sm.role = 'attendance_validator'
      and sm.can_validate_attendance
    order by sm.created_at;
end;
$$;

create or replace function public.add_structure_attendance_validator(
  p_structure_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_name text;
begin
  if not public.is_structure_owner(p_structure_id) then
    raise exception 'Acces refuse.';
  end if;
  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
  if v_user_id is null then
    return jsonb_build_object('state', 'account_not_found');
  end if;
  select p.full_name into v_name from public.profiles p where p.id = v_user_id;

  insert into public.structure_members(
    structure_id, user_id, role, can_validate_attendance
  ) values (
    p_structure_id, v_user_id, 'attendance_validator', true
  )
  on conflict (structure_id, user_id) do update
    set role = 'attendance_validator', can_validate_attendance = true;

  return jsonb_build_object('state', 'added', 'user_id', v_user_id, 'full_name', v_name);
end;
$$;

create or replace function public.remove_structure_attendance_validator(
  p_structure_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_structure_owner(p_structure_id) then
    raise exception 'Acces refuse.';
  end if;
  delete from public.structure_members
  where structure_id = p_structure_id
    and user_id = p_user_id
    and role = 'attendance_validator';
  return jsonb_build_object('state', 'removed');
end;
$$;

revoke execute on function public.list_validator_missions() from public, anon;
revoke execute on function public.get_mission_validation_card(uuid) from public, anon;
revoke execute on function public.issue_mission_validation_pin(uuid, text) from public, anon;
revoke execute on function public.get_worker_validation_context(text, text) from public, anon;
revoke execute on function public.validate_mission_attendance(text, text, text, text, text) from public, anon;
revoke execute on function public.list_structure_validators(uuid) from public, anon;
revoke execute on function public.add_structure_attendance_validator(uuid, text) from public, anon;
revoke execute on function public.remove_structure_attendance_validator(uuid, uuid) from public, anon;

grant execute on function public.list_validator_missions() to authenticated;
grant execute on function public.get_mission_validation_card(uuid) to authenticated;
grant execute on function public.issue_mission_validation_pin(uuid, text) to authenticated;
grant execute on function public.get_worker_validation_context(text, text) to authenticated;
grant execute on function public.validate_mission_attendance(text, text, text, text, text) to authenticated;
grant execute on function public.list_structure_validators(uuid) to authenticated;
grant execute on function public.add_structure_attendance_validator(uuid, text) to authenticated;
grant execute on function public.remove_structure_attendance_validator(uuid, uuid) to authenticated;

comment on table public.attendance_validation_attempts is
  'Journal immuable des validations QR/PIN, echecs et blocages.';
comment on function public.issue_mission_validation_pin(uuid, text) is
  'Emet un PIN a 6 chiffres valable 3 minutes pour un employe autorise.';
