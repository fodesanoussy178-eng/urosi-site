-- 0007 : synchronisation avec la prod + moteur de remuneration intelligente.
--
-- Partie A — sync : colonnes/fonctions deja presentes en prod (profils
-- enrichis, abonnement structure) pour que ce fichier reste la source de
-- verite sur un environnement neuf.
-- Partie B — remuneration intelligente : la structure definit des regles
-- (pay_rules) ; a la publication, un trigger calcule la remuneration finale
-- et stocke le detail (pricing_breakdown) visible par le travailleur.

-- ---------------------------------------------------------------------------
-- A. Sync prod : profils enrichis + abonnement structure
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists address text;

alter table public.structures add column if not exists subscription_active boolean not null default false;
alter table public.structures add column if not exists subscribed_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, city, phone, birth_date, address)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'role', 'worker'),
    nullif(new.raw_user_meta_data ->> 'city', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    case
      when coalesce(new.raw_user_meta_data ->> 'birth_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (new.raw_user_meta_data ->> 'birth_date')::date
      else null
    end,
    nullif(new.raw_user_meta_data ->> 'address', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.is_founder()
returns boolean
language sql stable set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'fodesanoussy178@gmail.com'
$$;

create or replace function public.subscribe_structure(p_structure_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.structures
  set subscription_active = true,
      subscribed_at = now()
  where id = p_structure_id
    and owner_id = auth.uid();
  if not found then
    raise exception 'Structure introuvable ou non autorisee.';
  end if;
end;
$$;

create or replace function public.enforce_structure_subscription()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_active boolean;
begin
  if public.is_founder() then
    return new;
  end if;
  select subscription_active into v_active
  from public.structures
  where id = new.structure_id;
  if not coalesce(v_active, false) then
    raise exception 'Abonnement requis : abonne ta structure pour publier des missions.';
  end if;
  return new;
end;
$$;

drop trigger if exists missions_require_subscription on public.missions;
create trigger missions_require_subscription
  before insert on public.missions
  for each row execute function public.enforce_structure_subscription();

-- ---------------------------------------------------------------------------
-- B1. Missions enrichies : secteur, difficulte, urgence, heure, geoloc
-- ---------------------------------------------------------------------------
alter table public.missions add column if not exists sector text not null default 'autre';
alter table public.missions drop constraint if exists missions_sector_check;
alter table public.missions
  add constraint missions_sector_check
  check (sector in ('restauration', 'vente', 'logistique', 'evenementiel', 'nettoyage', 'manutention', 'administratif', 'autre'));

alter table public.missions add column if not exists difficulty smallint not null default 1;
alter table public.missions drop constraint if exists missions_difficulty_check;
alter table public.missions
  add constraint missions_difficulty_check check (difficulty between 1 and 3);

alter table public.missions add column if not exists is_urgent boolean not null default false;
alter table public.missions add column if not exists start_time time;
alter table public.missions add column if not exists address text;
alter table public.missions add column if not exists lat double precision;
alter table public.missions add column if not exists lng double precision;
alter table public.missions add column if not exists distance_km numeric;
alter table public.missions add column if not exists base_rate_cents integer;
alter table public.missions add column if not exists pricing_breakdown jsonb;

create index if not exists missions_sector_status_idx on public.missions (sector, status);

-- ---------------------------------------------------------------------------
-- B2. pay_rules : regles de remuneration configurables par la structure
-- ---------------------------------------------------------------------------
create table if not exists public.pay_rules (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures (id) on delete cascade,
  kind text not null check (kind in (
    'day_of_week', 'holiday', 'time_of_day', 'duration', 'sector',
    'difficulty', 'urgency', 'distance', 'tension', 'custom'
  )),
  label text not null,
  params jsonb not null default '{}'::jsonb,
  adjust_pct integer not null default 0 check (adjust_pct between -50 and 200),
  adjust_cents integer not null default 0 check (adjust_cents between -50000 and 50000),
  priority integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists pay_rules_structure_id_idx on public.pay_rules (structure_id);

alter table public.pay_rules enable row level security;

drop policy if exists "pay_rules: owner all" on public.pay_rules;
create policy "pay_rules: owner all"
  on public.pay_rules for all
  using (public.is_structure_owner(structure_id))
  with check (public.is_structure_owner(structure_id));

-- ---------------------------------------------------------------------------
-- B3. Jours feries francais (fixes + mobiles via Paques, algorithme de Butcher)
-- ---------------------------------------------------------------------------
create or replace function public.easter_date(p_year integer)
returns date
language plpgsql immutable
as $$
declare
  a int := p_year % 19;
  b int := p_year / 100;
  c int := p_year % 100;
  d int := b / 4;
  e int := b % 4;
  f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4;
  k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7;
  m int := (a + 11 * h + 22 * l) / 451;
  v_month int := (h + l - 7 * m + 114) / 31;
  v_day int := ((h + l - 7 * m + 114) % 31) + 1;
begin
  return make_date(p_year, v_month, v_day);
end;
$$;

create or replace function public.is_french_holiday(p_date date)
returns boolean
language plpgsql immutable
as $$
declare
  y int := extract(year from p_date)::int;
  e date := public.easter_date(y);
begin
  return p_date in (
    make_date(y, 1, 1),   -- Jour de l'an
    make_date(y, 5, 1),   -- Fete du travail
    make_date(y, 5, 8),   -- Victoire 1945
    make_date(y, 7, 14),  -- Fete nationale
    make_date(y, 8, 15),  -- Assomption
    make_date(y, 11, 1),  -- Toussaint
    make_date(y, 11, 11), -- Armistice
    make_date(y, 12, 25), -- Noel
    e + 1,                -- Lundi de Paques
    e + 39,               -- Ascension
    e + 50                -- Lundi de Pentecote
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- B4. Moteur : compute_mission_pricing applique les regles actives de la
-- structure et retourne { base_cents, adjustments[], total_cents }.
-- Egalement appelable en RPC pour l'apercu live du formulaire de publication.
-- ---------------------------------------------------------------------------
create or replace function public.compute_mission_pricing(
  p_structure_id uuid,
  p_base_cents integer,
  p_date date,
  p_start_time time default null,
  p_duration_minutes integer default 0,
  p_sector text default 'autre',
  p_difficulty integer default 1,
  p_urgent boolean default false,
  p_distance_km numeric default null
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  r record;
  v_base integer := greatest(coalesce(p_base_cents, 0), 0);
  v_adjustments jsonb := '[]'::jsonb;
  v_total integer;
  v_amount integer;
  v_applies boolean;
  v_from time;
  v_to time;
  v_open bigint;
  v_apps bigint;
begin
  v_total := v_base;

  for r in
    select * from public.pay_rules
    where structure_id = p_structure_id and active
    order by priority, created_at
  loop
    v_applies := false;

    case r.kind
      when 'day_of_week' then
        -- params.days : jours ISO (1 = lundi … 7 = dimanche)
        v_applies := coalesce(r.params -> 'days', '[]'::jsonb) @> to_jsonb(extract(isodow from p_date)::int);
      when 'holiday' then
        v_applies := public.is_french_holiday(p_date);
      when 'time_of_day' then
        if p_start_time is not null then
          v_from := coalesce(nullif(r.params ->> 'from', '')::time, time '21:00');
          v_to := coalesce(nullif(r.params ->> 'to', '')::time, time '06:00');
          if v_from <= v_to then
            v_applies := p_start_time >= v_from and p_start_time < v_to;
          else
            -- plage passant minuit (ex. 21:00 -> 06:00)
            v_applies := p_start_time >= v_from or p_start_time < v_to;
          end if;
        end if;
      when 'duration' then
        v_applies := coalesce(p_duration_minutes, 0) >= coalesce(nullif(r.params ->> 'min_minutes', '')::int, 240);
      when 'sector' then
        v_applies := coalesce(r.params -> 'sectors', '[]'::jsonb) @> to_jsonb(coalesce(p_sector, 'autre'));
      when 'difficulty' then
        v_applies := coalesce(p_difficulty, 1) >= coalesce(nullif(r.params ->> 'min_level', '')::int, 3);
      when 'urgency' then
        v_applies := coalesce(p_urgent, false);
      when 'distance' then
        v_applies := p_distance_km is not null
          and p_distance_km >= coalesce(nullif(r.params ->> 'min_km', '')::numeric, 10);
      when 'tension' then
        -- tension offre/demande : missions ouvertes du secteur vs candidatures
        select count(*) into v_open
        from public.missions m
        where m.status = 'open' and m.sector = coalesce(p_sector, 'autre') and m.scheduled_date >= current_date;
        select count(*) into v_apps
        from public.applications a
        join public.missions m on m.id = a.mission_id
        where m.status = 'open' and m.sector = coalesce(p_sector, 'autre') and m.scheduled_date >= current_date;
        v_applies := v_open > 0
          and (v_open::numeric / greatest(v_apps, 1)) >= coalesce(nullif(r.params ->> 'min_ratio', '')::numeric, 2);
      when 'custom' then
        v_applies := true;
      else
        v_applies := false;
    end case;

    if v_applies then
      v_amount := round(v_base * coalesce(r.adjust_pct, 0) / 100.0)::int + coalesce(r.adjust_cents, 0);
      if v_amount <> 0 then
        v_adjustments := v_adjustments || jsonb_build_object(
          'rule_id', r.id,
          'kind', r.kind,
          'label', r.label,
          'amount_cents', v_amount
        );
        v_total := v_total + v_amount;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'base_cents', v_base,
    'adjustments', v_adjustments,
    'total_cents', greatest(v_total, 0)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- B5. Trigger : a la publication, la remuneration finale et le detail sont
-- figes sur la mission (le travailleur voit exactement ce qui a ete calcule).
-- ---------------------------------------------------------------------------
create or replace function public.missions_apply_pricing()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v jsonb;
begin
  if new.is_solidaire then
    new.base_rate_cents := 0;
    new.pricing_breakdown := null;
    return new;
  end if;

  new.base_rate_cents := greatest(coalesce(new.base_rate_cents, new.worker_rate_cents), 1);
  v := public.compute_mission_pricing(
    new.structure_id,
    new.base_rate_cents,
    new.scheduled_date,
    new.start_time,
    new.duration_minutes,
    coalesce(new.sector, 'autre'),
    coalesce(new.difficulty, 1),
    coalesce(new.is_urgent, false),
    new.distance_km
  );
  new.worker_rate_cents := greatest((v ->> 'total_cents')::int, 1);
  new.pricing_breakdown := v;
  return new;
end;
$$;

drop trigger if exists missions_apply_pricing on public.missions;
create trigger missions_apply_pricing
  before insert on public.missions
  for each row execute function public.missions_apply_pricing();
