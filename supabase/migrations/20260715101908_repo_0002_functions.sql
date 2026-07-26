-- Fonctions et triggers portant les regles metier du modele mandataire.

-- ---------------------------------------------------------------------------
-- handle_new_user : cree automatiquement la ligne profiles a l'inscription,
-- avec le role choisi par l'utilisateur (metadonnees passees a signUp()).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'role', 'worker')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- enforce_consecutive_days_cap : un travailleur qui n'est pas
-- micro-entrepreneur ne peut pas enchainer plus de 3 jours consecutifs de
-- missions acceptees pour la meme structure (protection contre le
-- requalification en salariat deguise).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_consecutive_days_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_structure_id uuid;
  v_new_date date;
  v_is_micro boolean;
  v_dates date[];
  v_run integer;
  v_max_run integer;
  v_d date;
  v_prev date;
begin
  select structure_id, scheduled_date into v_structure_id, v_new_date
  from public.missions where id = new.mission_id;

  select coalesce(is_micro_entrepreneur, false) into v_is_micro
  from public.profiles where id = new.worker_id;

  if v_is_micro then
    return new;
  end if;

  select array_agg(distinct m.scheduled_date order by m.scheduled_date)
  into v_dates
  from public.applications a
  join public.missions m on m.id = a.mission_id
  where a.worker_id = new.worker_id
    and a.status = 'accepted'
    and a.id <> new.id
    and m.structure_id = v_structure_id;

  v_dates := array_append(coalesce(v_dates, array[]::date[]), v_new_date);

  select array_agg(distinct d order by d) into v_dates from unnest(v_dates) d;

  v_run := 1;
  v_max_run := 1;
  v_prev := null;

  foreach v_d in array v_dates loop
    if v_prev is not null and v_d = v_prev + 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;
    if v_run > v_max_run then
      v_max_run := v_run;
    end if;
    v_prev := v_d;
  end loop;

  if v_max_run > 3 then
    raise exception 'Plafond legal depasse : 3 jours consecutifs maximum pour la meme structure (travailleur non micro-entrepreneur).'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists applications_consecutive_days_cap on public.applications;
create trigger applications_consecutive_days_cap
  before insert or update of status on public.applications
  for each row
  when (new.status = 'accepted')
  execute function public.enforce_consecutive_days_cap();

-- ---------------------------------------------------------------------------
-- reliability_index : indice de fiabilite calcule par travailleur, en
-- security_invoker pour que chacun ne voie que le sien via les policies RLS
-- de la table sous-jacente (voir 0003_rls.sql).
-- ---------------------------------------------------------------------------
create or replace view public.reliability_index
with (security_invoker = on) as
select
  a.worker_id,
  count(*) filter (where a.status = 'accepted') as accepted_count,
  count(*) filter (where a.status = 'rejected') as rejected_count,
  count(*) filter (where a.status = 'cancelled') as cancelled_count,
  count(*) as total_applications,
  case
    when count(*) filter (where a.status in ('accepted', 'cancelled')) = 0 then null
    else round(
      100.0 * count(*) filter (where a.status = 'accepted')
      / nullif(count(*) filter (where a.status in ('accepted', 'cancelled')), 0),
      1
    )
  end as reliability_score
from public.applications a
group by a.worker_id;

comment on view public.reliability_index is
  'Indice informatif, non-determinant : jamais utilise pour filtrer l''acces aux missions.';
