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

    perform private.finalize_mission_end(v_app.id);

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
