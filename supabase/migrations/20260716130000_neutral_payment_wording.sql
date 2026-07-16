-- Audit 2026-07-16 (H1) : tant que le PSP n'est pas branche, aucun credit
-- reel n'a lieu (private.guard_simulated_payment bloque provider='internal'
-- hors staging et release_payment_ready_mission est reservee au backend).
-- Les notifications de fin de mission ne doivent donc rien promettre.
-- Cette migration remplace uniquement le wording des notifications des deux
-- fonctions actives concernees, sans toucher a la logique financiere :
--   - public.confirm_attendance_qr        (derniere definition : 0015)
--   - public.validate_mission_attendance_core
--     (definie dans 20260716120000, renommee par 20260716123000)
-- Les anciens messages de 0009/0013 (process_mission_payment) sont deja
-- remplaces par le wording neutre de 20260715091205 : rien a faire pour eux.

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
      'Fin de mission confirmee. Le paiement sera declenche des l''activation des versements.',
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

revoke execute on function public.confirm_attendance_qr(text) from public, anon;
grant execute on function public.confirm_attendance_qr(text) to authenticated;

-- Meme correction pour le coeur de validation QR + PIN. Corps identique a
-- 20260716120000 (avec le search_path corrige par 20260716121000) : seule la
-- notification de fin de mission change.
create or replace function public.validate_mission_attendance_core(
  p_qr_code text default null,
  p_mission_code text default null,
  p_pin text default null,
  p_step text default null,
  p_manual_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
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
      'Ta mission est terminee. Le paiement sera declenche des l''activation des versements.',
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

revoke execute on function public.validate_mission_attendance_core(text, text, text, text, text)
  from public, anon, authenticated;

-- Audit 2026-07-16 (H2) : aucun declencheur J+3 n'existe encore. Les
-- candidatures restent volontairement en payment_pending tant que le PSP
-- n'est pas actif. Au go-live, planifier l'Edge Function
-- supabase/functions/release-due-payments (service_role) ou un job pg_cron
-- equivalent qui appelle cette fonction pour chaque candidature echue.
comment on function public.release_payment_ready_mission(uuid) is
  'Passage payment_pending -> completed reserve au backend (service_role). '
  'TODO go-live PSP : planifier supabase/functions/release-due-payments '
  '(ou pg_cron) pour appeler cette fonction quand payment_ready_at <= now(). '
  'Ne pas planifier avant l''activation du PSP : guard_simulated_payment '
  'bloque les paiements internes hors staging.';
