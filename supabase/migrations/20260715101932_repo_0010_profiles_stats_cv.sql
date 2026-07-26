-- 0010 : profils enrichis (bio, competences), statistiques et CV vivant.

-- ---------------------------------------------------------------------------
-- profiles : bio + competences pour le CV vivant
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists skills text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- structure_stats : tableau de bord de la structure (reserve au proprietaire)
-- ---------------------------------------------------------------------------
create or replace function public.structure_stats(p_structure_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_structure_owner(p_structure_id) then
    raise exception 'Non autorisé.';
  end if;

  select jsonb_build_object(
    'missions_total', count(*),
    'missions_open', count(*) filter (where m.status = 'open'),
    'applications_total', (
      select count(*) from public.applications a
      join public.missions mm on mm.id = a.mission_id
      where mm.structure_id = p_structure_id
    ),
    'applications_pending', (
      select count(*) from public.applications a
      join public.missions mm on mm.id = a.mission_id
      where mm.structure_id = p_structure_id and a.status = 'pending'
    ),
    'missions_completed', (
      select count(*) from public.applications a
      join public.missions mm on mm.id = a.mission_id
      where mm.structure_id = p_structure_id and a.status = 'completed'
    ),
    'unique_workers', (
      select count(distinct a.worker_id) from public.applications a
      join public.missions mm on mm.id = a.mission_id
      where mm.structure_id = p_structure_id and a.status = 'completed'
    ),
    'total_paid_cents', coalesce((
      select sum(p.worker_amount_cents) from public.payments p
      where p.structure_id = p_structure_id and p.status = 'released'
    ), 0),
    'total_commission_cents', coalesce((
      select sum(p.commission_cents) from public.payments p
      where p.structure_id = p_structure_id and p.status = 'released'
    ), 0),
    'total_bonus_cents', coalesce((
      select sum(p.bonus_cents) from public.payments p
      where p.structure_id = p_structure_id and p.status = 'released'
    ), 0),
    'avg_rating', (
      select round(avg(r.score), 2) from public.ratings r
      where r.structure_id = p_structure_id and r.direction = 'worker_to_structure'
    ),
    'ratings_count', (
      select count(*) from public.ratings r
      where r.structure_id = p_structure_id and r.direction = 'worker_to_structure'
    )
  )
  into v
  from public.missions m
  where m.structure_id = p_structure_id;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- worker_stats : statistiques personnelles du travailleur connecte
-- ---------------------------------------------------------------------------
create or replace function public.worker_stats()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then
    raise exception 'Non autorisé.';
  end if;

  select jsonb_build_object(
    'completed_count', count(*) filter (where a.status = 'completed'),
    'upcoming_count', count(*) filter (where a.status = 'accepted'),
    'pending_count', count(*) filter (where a.status = 'pending'),
    'earnings_total_cents', coalesce((
      select sum(p.worker_amount_cents) from public.payments p
      where p.worker_id = auth.uid() and p.status = 'released'
    ), 0),
    'bonus_total_cents', coalesce((
      select sum(p.bonus_cents) from public.payments p
      where p.worker_id = auth.uid() and p.status = 'released'
    ), 0),
    'avg_rating', (
      select round(avg(r.score), 2) from public.ratings r
      where r.worker_id = auth.uid() and r.direction = 'structure_to_worker'
    ),
    'monthly', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select to_char(date_trunc('month', p.released_at), 'YYYY-MM') as month,
               sum(p.worker_amount_cents)::int as earnings_cents,
               count(*)::int as missions
        from public.payments p
        where p.worker_id = auth.uid()
          and p.status = 'released'
          and p.released_at >= date_trunc('month', now()) - interval '5 months'
        group by 1
        order by 1
      ) t
    ), '[]'::jsonb)
  )
  into v
  from public.applications a
  where a.worker_id = auth.uid();

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- worker_cv : CV vivant consultable par le travailleur lui-meme et par les
-- structures aupres desquelles il a candidate (jamais bloquant, cf. CGU).
-- ---------------------------------------------------------------------------
create or replace function public.worker_cv(p_worker_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is null or (auth.uid() <> p_worker_id and not public.is_my_applicant(p_worker_id)) then
    raise exception 'Non autorisé.';
  end if;

  select jsonb_build_object(
    'full_name', pr.full_name,
    'city', pr.city,
    'bio', pr.bio,
    'skills', to_jsonb(pr.skills),
    'completed_count', (
      select count(*) from public.applications a
      where a.worker_id = p_worker_id and a.status = 'completed'
    ),
    'avg_rating', (
      select round(avg(r.score), 2) from public.ratings r
      where r.worker_id = p_worker_id and r.direction = 'structure_to_worker'
    ),
    'ratings_count', (
      select count(*) from public.ratings r
      where r.worker_id = p_worker_id and r.direction = 'structure_to_worker'
    ),
    'experiences', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select m.title, m.sector, m.scheduled_date, s.name as structure_name,
               (a.checked_in_at is not null) as presence_validated,
               (select r.score from public.ratings r
                where r.application_id = a.id and r.direction = 'structure_to_worker') as score
        from public.applications a
        join public.missions m on m.id = a.mission_id
        join public.structures s on s.id = m.structure_id
        where a.worker_id = p_worker_id and a.status = 'completed'
        order by m.scheduled_date desc
        limit 50
      ) t
    ), '[]'::jsonb)
  )
  into v
  from public.profiles pr
  where pr.id = p_worker_id;

  return v;
end;
$$;
