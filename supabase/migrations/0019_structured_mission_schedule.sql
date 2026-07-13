-- 0019 : horaires reels, cout structure et donnees analytiques propres.
-- Les champs historiques (scheduled_date, start_time, duration_minutes, places,
-- worker_rate_cents) restent alimentes pour ne pas casser les ecrans existants.

-- Compatibilite prod : certaines bases ont 0019 sans avoir encore toutes les
-- colonnes de 0006/0007/0014. Ces ajouts sont idempotents et ne suppriment
-- aucune donnee.
alter table public.missions add column if not exists is_solidaire boolean not null default false;
alter table public.missions add column if not exists sector text not null default 'autre';
alter table public.missions add column if not exists difficulty smallint not null default 1;
alter table public.missions add column if not exists is_urgent boolean not null default false;
alter table public.missions add column if not exists start_time time;
alter table public.missions add column if not exists duration_minutes integer not null default 60;
alter table public.missions add column if not exists address text;
alter table public.missions add column if not exists lat double precision;
alter table public.missions add column if not exists lng double precision;
alter table public.missions add column if not exists distance_km numeric;
alter table public.missions add column if not exists worker_rate_cents integer not null default 1000;
alter table public.missions add column if not exists base_rate_cents integer;
alter table public.missions add column if not exists pricing_breakdown jsonb;
alter table public.missions add column if not exists places integer not null default 1;
alter table public.missions add column if not exists slots jsonb;

alter table public.missions drop constraint if exists missions_worker_rate_cents_check;
alter table public.missions
  add constraint missions_worker_rate_cents_check
  check (
    (is_solidaire and worker_rate_cents = 0)
    or (not is_solidaire and worker_rate_cents > 0)
  );

alter table public.missions drop constraint if exists missions_duration_minutes_check;
alter table public.missions
  add constraint missions_duration_minutes_check
  check (duration_minutes >= 60 and duration_minutes <= 4320);

alter table public.missions drop constraint if exists missions_sector_check;
alter table public.missions
  add constraint missions_sector_check
  check (sector in ('restauration', 'vente', 'logistique', 'evenementiel', 'nettoyage', 'manutention', 'administratif', 'autre'));

alter table public.missions drop constraint if exists missions_difficulty_check;
alter table public.missions
  add constraint missions_difficulty_check check (difficulty between 1 and 3);

alter table public.missions drop constraint if exists missions_places_check;
alter table public.missions
  add constraint missions_places_check check (places between 1 and 20);

alter table public.missions add column if not exists starts_at timestamptz;
alter table public.missions add column if not exists ends_at timestamptz;
alter table public.missions add column if not exists mission_days integer not null default 1 check (mission_days between 1 and 3);
alter table public.missions add column if not exists duration_minutes_per_person integer;
alter table public.missions add column if not exists positions integer not null default 1 check (positions between 1 and 20);
alter table public.missions add column if not exists total_worker_hours numeric(10,2) not null default 0;
alter table public.missions add column if not exists hourly_rate numeric(10,2);
alter table public.missions add column if not exists worker_amount numeric(12,2) not null default 0;
alter table public.missions add column if not exists worker_subtotal numeric(12,2) not null default 0;
alter table public.missions add column if not exists service_fee numeric(12,2) not null default 0;
alter table public.missions add column if not exists structure_total numeric(12,2) not null default 0;
alter table public.missions add column if not exists time_slot text not null default 'afternoon';
alter table public.missions add column if not exists day_of_week text;
alter table public.missions add column if not exists mission_category text not null default 'autre';
alter table public.missions add column if not exists location text;

alter table public.missions drop constraint if exists missions_time_slot_check;
alter table public.missions
  add constraint missions_time_slot_check
  check (time_slot in ('morning', 'afternoon', 'evening', 'night'));

alter table public.missions drop constraint if exists missions_day_of_week_check;
alter table public.missions
  add constraint missions_day_of_week_check
  check (day_of_week is null or day_of_week in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'));

alter table public.missions drop constraint if exists missions_money_totals_check;
alter table public.missions
  add constraint missions_money_totals_check
  check (
    total_worker_hours >= 0
    and worker_amount >= 0
    and worker_subtotal >= 0
    and service_fee >= 0
    and structure_total >= 0
    and (hourly_rate is null or hourly_rate >= 0)
  );

create table if not exists public.mission_days (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 1440),
  created_at timestamptz not null default now()
);

create index if not exists mission_days_mission_id_idx on public.mission_days(mission_id);
create index if not exists mission_days_starts_at_idx on public.mission_days(starts_at);
create index if not exists missions_starts_at_idx on public.missions(starts_at);
create index if not exists missions_time_slot_status_idx on public.missions(time_slot, status);
create index if not exists missions_day_status_idx on public.missions(day_of_week, status);
create index if not exists missions_category_status_idx on public.missions(mission_category, status);
create index if not exists missions_location_status_idx on public.missions(location, status);
create index if not exists missions_urgent_status_idx on public.missions(is_urgent, status);

alter table public.mission_days enable row level security;

drop policy if exists "mission_days: read open or own structure" on public.mission_days;
create policy "mission_days: read open or own structure"
  on public.mission_days for select
  using (
    exists (
      select 1 from public.missions m
      where m.id = mission_days.mission_id
        and (m.status = 'open' or public.is_structure_owner(m.structure_id))
    )
  );

drop policy if exists "mission_days: owner insert" on public.mission_days;
create policy "mission_days: owner insert"
  on public.mission_days for insert
  with check (
    exists (
      select 1 from public.missions m
      where m.id = mission_days.mission_id
        and public.is_structure_owner(m.structure_id)
    )
  );

drop policy if exists "mission_days: owner update" on public.mission_days;
create policy "mission_days: owner update"
  on public.mission_days for update
  using (
    exists (
      select 1 from public.missions m
      where m.id = mission_days.mission_id
        and public.is_structure_owner(m.structure_id)
    )
  )
  with check (
    exists (
      select 1 from public.missions m
      where m.id = mission_days.mission_id
        and public.is_structure_owner(m.structure_id)
    )
  );

drop policy if exists "mission_days: owner delete" on public.mission_days;
create policy "mission_days: owner delete"
  on public.mission_days for delete
  using (
    exists (
      select 1 from public.missions m
      where m.id = mission_days.mission_id
        and public.is_structure_owner(m.structure_id)
    )
  );

grant select on public.mission_days to anon, authenticated;
grant insert, update, delete on public.mission_days to authenticated;

create or replace function public.mission_day_name(p_date timestamptz)
returns text
language sql stable
as $$
  select case extract(isodow from p_date at time zone 'Europe/Paris')::int
    when 1 then 'monday'
    when 2 then 'tuesday'
    when 3 then 'wednesday'
    when 4 then 'thursday'
    when 5 then 'friday'
    when 6 then 'saturday'
    else 'sunday'
  end
$$;

create or replace function public.mission_time_slot(p_start timestamptz, p_end timestamptz)
returns text
language plpgsql stable
as $$
declare
  v_hour int;
begin
  if (p_end at time zone 'Europe/Paris')::date > (p_start at time zone 'Europe/Paris')::date then
    return 'night';
  end if;
  v_hour := extract(hour from p_start at time zone 'Europe/Paris')::int;
  if v_hour >= 5 and v_hour < 12 then
    return 'morning';
  elsif v_hour >= 12 and v_hour < 18 then
    return 'afternoon';
  elsif v_hour >= 18 and v_hour < 22 then
    return 'evening';
  end if;
  return 'night';
end;
$$;

create or replace function public.missions_apply_slots()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  s jsonb;
  v_date date;
  v_start time;
  v_end time;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_duration integer;
  v_total integer := 0;
  v_min_start timestamptz := null;
  v_max_end timestamptz := null;
  v_start_dates date[] := '{}';
  v_days integer;
  v_positions integer;
  v_worker_amount numeric;
  v_worker_subtotal numeric;
begin
  v_positions := greatest(coalesce(nullif(new.positions, 0), nullif(new.places, 0), 1), 1);
  new.positions := v_positions;
  new.places := v_positions;
  new.location := coalesce(nullif(new.location, ''), nullif(new.address, ''), new.city);

  if new.slots is not null then
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
        raise exception 'Chaque jour doit avoir une date, une heure de début et une heure de fin.';
      end if;
      if v_end = v_start then
        raise exception 'La durée ne peut pas être nulle (%).', v_date;
      end if;

      v_start_at := (v_date::text || ' ' || v_start::text || ' Europe/Paris')::timestamptz;
      v_end_at := ((case when v_end < v_start then (v_date + 1) else v_date end)::text || ' ' || v_end::text || ' Europe/Paris')::timestamptz;
      v_duration := (extract(epoch from (v_end_at - v_start_at)) / 60)::int;
      if v_duration <= 0 then
        raise exception 'Durée invalide (%).', v_date;
      end if;

      v_total := v_total + v_duration;
      if v_min_start is null or v_start_at < v_min_start then
        v_min_start := v_start_at;
      end if;
      if v_max_end is null or v_end_at > v_max_end then
        v_max_end := v_end_at;
      end if;
      if not v_date = any(v_start_dates) then
        v_start_dates := array_append(v_start_dates, v_date);
      end if;
    end loop;

    v_days := coalesce(array_length(v_start_dates, 1), 1);
    if v_days > 3 then
      raise exception 'Une mission dure 3 jours maximum.';
    end if;
    if v_total < 60 then
      raise exception 'Durée totale minimale : 1 heure.';
    end if;
    if v_total > 4320 then
      raise exception 'Durée totale maximale : 3 jours.';
    end if;

    new.starts_at := v_min_start;
    new.ends_at := v_max_end;
    new.duration_minutes := v_total;
    new.duration_minutes_per_person := v_total;
    new.scheduled_date := (v_min_start at time zone 'Europe/Paris')::date;
    new.start_time := (v_min_start at time zone 'Europe/Paris')::time;
    new.mission_days := v_days;
    new.day_of_week := public.mission_day_name(v_min_start);
    new.time_slot := public.mission_time_slot(v_min_start, v_max_end);
  end if;

  new.duration_minutes_per_person := coalesce(new.duration_minutes_per_person, new.duration_minutes);
  new.starts_at := coalesce(new.starts_at, (new.scheduled_date::text || ' ' || coalesce(new.start_time, '09:00'::time)::text || ' Europe/Paris')::timestamptz);
  new.ends_at := coalesce(new.ends_at, new.starts_at + make_interval(mins => new.duration_minutes));
  new.mission_days := coalesce(new.mission_days, 1);
  new.day_of_week := coalesce(new.day_of_week, public.mission_day_name(new.starts_at));
  new.time_slot := coalesce(new.time_slot, public.mission_time_slot(new.starts_at, new.ends_at));

  if new.is_solidaire then
    new.hourly_rate := coalesce(new.hourly_rate, 0);
    new.worker_amount := 0;
    new.worker_subtotal := 0;
    new.service_fee := 0;
    new.structure_total := 0;
    new.worker_rate_cents := 0;
    new.base_rate_cents := 0;
  else
    v_worker_amount := coalesce(nullif(new.worker_amount, 0), greatest(coalesce(new.worker_rate_cents, 0), 0) / 100.0);
    new.worker_amount := round(v_worker_amount, 2);
    v_worker_subtotal := coalesce(nullif(new.worker_subtotal, 0), new.worker_amount * v_positions);
    new.worker_subtotal := round(v_worker_subtotal, 2);
    new.service_fee := round(coalesce(nullif(new.service_fee, 0), new.worker_subtotal * 0.18), 2);
    new.structure_total := round(coalesce(nullif(new.structure_total, 0), new.worker_subtotal + new.service_fee), 2);
    new.worker_rate_cents := greatest(round(new.worker_amount * 100)::int, 1);
    new.base_rate_cents := coalesce(new.base_rate_cents, new.worker_rate_cents);
  end if;

  new.total_worker_hours := round((new.duration_minutes_per_person / 60.0) * v_positions, 2);
  return new;
end;
$$;

create or replace function public.missions_sync_days()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  s jsonb;
  v_date date;
  v_start time;
  v_end time;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_duration integer;
begin
  delete from public.mission_days where mission_id = new.id;
  if new.slots is null then
    insert into public.mission_days(mission_id, date, starts_at, ends_at, duration_minutes)
    values (new.id, (new.starts_at at time zone 'Europe/Paris')::date, new.starts_at, new.ends_at, new.duration_minutes_per_person);
    return new;
  end if;

  for s in select * from jsonb_array_elements(new.slots)
  loop
    v_date := (s ->> 'date')::date;
    v_start := (s ->> 'start')::time;
    v_end := (s ->> 'end')::time;
    v_start_at := (v_date::text || ' ' || v_start::text || ' Europe/Paris')::timestamptz;
    v_end_at := ((case when v_end < v_start then (v_date + 1) else v_date end)::text || ' ' || v_end::text || ' Europe/Paris')::timestamptz;
    v_duration := (extract(epoch from (v_end_at - v_start_at)) / 60)::int;
    insert into public.mission_days(mission_id, date, starts_at, ends_at, duration_minutes)
    values (new.id, v_date, v_start_at, v_end_at, v_duration);
  end loop;

  return new;
end;
$$;

create or replace function public.missions_apply_pricing()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v jsonb;
begin
  if new.is_solidaire then
    new.base_rate_cents := 0;
    new.worker_rate_cents := 0;
    new.pricing_breakdown := null;
    return new;
  end if;

  if new.worker_amount is not null and new.worker_amount > 0 then
    new.base_rate_cents := greatest(round(new.worker_amount * 100)::int, 1);
    new.worker_rate_cents := new.base_rate_cents;
    new.pricing_breakdown := jsonb_build_object(
      'source', 'structure_schedule_form',
      'worker_amount', new.worker_amount,
      'worker_subtotal', new.worker_subtotal,
      'service_fee', new.service_fee,
      'structure_total', new.structure_total,
      'positions', new.positions,
      'duration_minutes_per_person', new.duration_minutes_per_person,
      'total_worker_hours', new.total_worker_hours
    );
    return new;
  end if;

  new.base_rate_cents := greatest(coalesce(new.base_rate_cents, new.worker_rate_cents), 1);
  if to_regprocedure('public.compute_mission_pricing(uuid,integer,date,time without time zone,integer,text,integer,boolean,numeric)') is not null then
    execute 'select public.compute_mission_pricing($1,$2,$3,$4,$5,$6,$7,$8,$9)'
      into v
      using
        new.structure_id,
        new.base_rate_cents,
        new.scheduled_date,
        new.start_time,
        new.duration_minutes,
        coalesce(new.sector, 'autre'),
        coalesce(new.difficulty, 1),
        coalesce(new.is_urgent, false),
        new.distance_km;
  else
    v := jsonb_build_object(
      'base_cents', new.base_rate_cents,
      'adjustments', '[]'::jsonb,
      'total_cents', new.base_rate_cents
    );
  end if;
  new.worker_rate_cents := greatest((v ->> 'total_cents')::int, 1);
  new.pricing_breakdown := v;
  return new;
end;
$$;

drop trigger if exists missions_apply_slots on public.missions;
create trigger missions_apply_slots
  before insert or update of slots, places, positions, worker_amount, worker_subtotal, service_fee, structure_total, is_solidaire
  on public.missions
  for each row execute function public.missions_apply_slots();

drop trigger if exists missions_sync_days on public.missions;
create trigger missions_sync_days
  after insert or update of slots, starts_at, ends_at, duration_minutes_per_person
  on public.missions
  for each row execute function public.missions_sync_days();

drop trigger if exists missions_apply_pricing on public.missions;
drop trigger if exists zz_missions_apply_pricing on public.missions;
create trigger zz_missions_apply_pricing
  before insert or update of worker_amount, is_solidaire, base_rate_cents, worker_rate_cents
  on public.missions
  for each row execute function public.missions_apply_pricing();

revoke execute on function public.missions_apply_slots() from public, anon, authenticated;
revoke execute on function public.missions_sync_days() from public, anon, authenticated;
revoke execute on function public.missions_apply_pricing() from public, anon, authenticated;
