-- 0014 : planning par journee (missions jusqu'a 3 jours) + nombre de places.
-- slots : [{"date":"2026-07-12","start":"11:00","end":"15:00"}, ...]
-- Le serveur recalcule duration_minutes / scheduled_date / start_time depuis
-- les creneaux et refuse toute mission depassant 3 jours.
-- (Version appliquee en prod via MCP le 2026-07-10.)

alter table public.missions add column if not exists places integer not null default 1
  check (places between 1 and 20);
alter table public.missions add column if not exists slots jsonb;

create or replace function public.missions_apply_slots()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  s jsonb;
  v_date date;
  v_start time;
  v_end time;
  v_total integer := 0;
  v_min_date date := null;
  v_max_date date := null;
  v_first_start time := null;
begin
  if new.slots is null then
    return new;
  end if;
  if jsonb_typeof(new.slots) <> 'array' or jsonb_array_length(new.slots) = 0 then
    raise exception 'Planning invalide.';
  end if;
  if jsonb_array_length(new.slots) > 12 then
    raise exception '12 créneaux maximum.';
  end if;

  for s in select * from jsonb_array_elements(new.slots)
  loop
    v_date := (s ->> 'date')::date;
    v_start := (s ->> 'start')::time;
    v_end := (s ->> 'end')::time;
    if v_date is null or v_start is null or v_end is null then
      raise exception 'Chaque créneau doit avoir une date, une heure de début et une heure de fin.';
    end if;
    if v_end <= v_start then
      raise exception 'L''heure de fin doit être après l''heure de début (%).', v_date;
    end if;
    v_total := v_total + (extract(epoch from (v_end - v_start)) / 60)::int;
    if v_min_date is null or v_date < v_min_date then
      v_min_date := v_date;
    end if;
    if v_max_date is null or v_date > v_max_date then
      v_max_date := v_date;
    end if;
    if v_first_start is null or (v_date = v_min_date and v_start < v_first_start) then
      v_first_start := v_start;
    end if;
  end loop;

  if v_max_date - v_min_date > 2 then
    raise exception 'Une mission dure 3 jours maximum.';
  end if;
  if v_total < 60 then
    raise exception 'Durée totale minimale : 1 heure.';
  end if;
  if v_total > 4320 then
    raise exception 'Durée totale maximale : 3 jours.';
  end if;

  new.duration_minutes := v_total;
  new.scheduled_date := v_min_date;
  new.start_time := v_first_start;
  return new;
end;
$$;

drop trigger if exists missions_apply_slots on public.missions;
create trigger missions_apply_slots
  before insert on public.missions
  for each row execute function public.missions_apply_slots();

-- Le pricing doit voir la duree recalculee : on force l'ordre alphabetique
-- des triggers BEFORE en le recreant sous le nom zz_missions_apply_pricing.
drop trigger if exists missions_apply_pricing on public.missions;
drop trigger if exists zz_missions_apply_pricing on public.missions;
create trigger zz_missions_apply_pricing
  before insert on public.missions
  for each row execute function public.missions_apply_pricing();
