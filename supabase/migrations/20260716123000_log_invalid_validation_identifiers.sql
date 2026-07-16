-- Le coeur journalise deja les PIN invalides, expirations et blocages. Ce
-- wrapper ajoute les echecs qui surviennent avant d'avoir retrouve la mission.
alter function public.validate_mission_attendance(text, text, text, text, text)
  rename to validate_mission_attendance_core;

revoke execute on function public.validate_mission_attendance_core(text, text, text, text, text)
  from public, anon, authenticated;

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
  v_result jsonb;
  v_method text := case
    when nullif(trim(coalesce(p_qr_code, '')), '') is not null then 'qr'
    else 'manual'
  end;
begin
  v_result := public.validate_mission_attendance_core(
    p_qr_code, p_mission_code, p_pin, p_step, p_manual_reason
  );

  if p_step in ('start', 'end')
     and v_result->>'state' in ('invalid_identifier', 'manual_reason_required') then
    perform private.log_attendance_validation_attempt(
      null, null, auth.uid(), null, null, p_step, v_method,
      'failed', v_result->>'state', p_manual_reason
    );
  end if;
  return v_result;
end;
$$;

revoke execute on function public.validate_mission_attendance(text, text, text, text, text)
  from public, anon;
grant execute on function public.validate_mission_attendance(text, text, text, text, text)
  to authenticated;
