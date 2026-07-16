-- Supabase installe pgcrypto dans le schema extensions. Les fonctions
-- SECURITY DEFINER ayant un search_path vide doivent donc le qualifier.
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
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if p_step not in ('start', 'end') then raise exception 'Etape invalide.'; end if;

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

  v_first_day := coalesce((v_mission.starts_at at time zone 'Europe/Paris')::date, v_mission.scheduled_date);
  v_last_day := coalesce((v_mission.ends_at at time zone 'Europe/Paris')::date, v_first_day);
  if v_today < v_first_day or v_today > v_last_day then
    return jsonb_build_object('state', 'not_today', 'first_day', v_first_day, 'last_day', v_last_day);
  end if;

  update public.mission_validation_pins set revoked_at = now()
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

-- Compatibilite pour une base sur laquelle la premiere migration a deja ete
-- executee avant cette correction. Une installation neuve utilise deja le
-- nom qualifie extensions.crypt dans le corps de la fonction.
alter function public.validate_mission_attendance(text, text, text, text, text)
  set search_path = pg_catalog, extensions;
