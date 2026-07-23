-- Corrige un bug latent herite de 0015_attendance_qr_incidents.sql : ces
-- fonctions utilisent `search_path = public`, mais pgcrypto (gen_random_bytes,
-- digest) est installe dans le schema `extensions` sur Supabase, jamais dans
-- `public`. Comme ce chemin (create_mission_qr_token / get_scan_context /
-- confirm_attendance_qr) n'avait jamais ete branche a l'UI, l'erreur
-- "function gen_random_bytes(integer) does not exist" n'avait jamais ete
-- declenchee avant le test reel de bout en bout de cette session.

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

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

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
  v_hash text := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
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

create or replace function public.confirm_attendance_qr(p_token text, p_pin text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_hash text := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  v record;
  v_now timestamptz := now();
  v_delay integer := 0;
  v_delay_status text := 'on_time';
  v_authorized boolean;
  v_pin_row record;
  v_validator uuid;
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

  v_authorized := public.can_validate_structure_attendance(v.structure_id);
  v_validator := auth.uid();

  if not v_authorized then
    if coalesce(p_pin, '') !~ '^[0-9]{6}$' then
      raise exception using errcode = '42501', message = 'not_authorized';
    end if;

    select p.id, p.pin_hash, p.issued_to, p.expires_at
    into v_pin_row
    from public.mission_validation_pins p
    where p.mission_id = v.mission_id
      and p.step = v.type
      and p.revoked_at is null
    order by p.issued_at desc
    limit 1
    for update of p;

    if not found or v_pin_row.expires_at <= now()
       or extensions.crypt(p_pin, v_pin_row.pin_hash) <> v_pin_row.pin_hash then
      raise exception using errcode = '42501', message = 'invalid_pin';
    end if;

    update public.mission_validation_pins set revoked_at = now() where id = v_pin_row.id;
    v_validator := v_pin_row.issued_to;
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
        start_validated_by = v_validator,
        attendance_method_start = 'qr',
        attendance_status = 'start_confirmed',
        delay_minutes = v_delay,
        delay_status = v_delay_status,
        delay_confirmed_by = v_validator,
        status = 'in_progress'
    where id = v.application_id;

    insert into public.attendance_events (
      mission_id, application_id, worker_id, structure_id, event_type, method,
      validated_by, confirmed_time, note
    ) values (
      v.mission_id, v.application_id, v.worker_id, v.structure_id,
      'start_confirmed', 'qr', v_validator, v_now,
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
        end_validated_by = v_validator,
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
      'end_confirmed', 'qr', v_validator, v_now
    );

    insert into public.reliability_events (
      subject_type, subject_id, mission_id, application_id, event_type, status, source, metadata
    ) values (
      'worker', v.worker_id, v.mission_id, v.application_id,
      'mission_completed', 'confirmed', 'qr',
      jsonb_build_object('actual_end_at', v_now, 'payment_ready_at', v_now + interval '3 days')
    );

    perform private.finalize_mission_end(v.application_id);

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
