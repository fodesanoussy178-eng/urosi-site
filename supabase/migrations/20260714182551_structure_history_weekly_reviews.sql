-- Historique structure compact et avis hebdomadaires anonymises.

alter table public.ratings add column if not exists comment text;
alter table public.ratings drop constraint if exists ratings_comment_length_check;
alter table public.ratings
  add constraint ratings_comment_length_check
  check (comment is null or char_length(comment) <= 280);

-- Une structure ne lit jamais les lignes brutes worker_to_structure : elles
-- contiennent worker_id et application_id, donc permettent d'identifier
-- l'auteur. Les ecrans utilisent uniquement les RPC agregees ci-dessous.
drop policy if exists "ratings: authenticated read" on public.ratings;
drop policy if exists "ratings: participants read own" on public.ratings;
create policy "ratings: participants read own"
  on public.ratings for select
  to authenticated
  using (
    (direction = 'worker_to_structure' and worker_id = (select auth.uid()))
    or (
      direction = 'structure_to_worker'
      and (
        worker_id = (select auth.uid())
        or public.owns_completed_application(application_id)
      )
    )
  );

-- L'identite du travailleur et de la structure est derivee de la candidature :
-- un client ne peut pas detourner une candidature terminee pour noter une
-- autre structure ou un autre travailleur en modifiant le payload.
drop policy if exists "ratings: worker rates own completed application" on public.ratings;
create policy "ratings: worker rates own completed application"
  on public.ratings for insert
  to authenticated
  with check (
    ratings.direction = 'worker_to_structure'
    and ratings.worker_id = (select auth.uid())
    and exists (
      select 1
      from public.applications a
      join public.missions m on m.id = a.mission_id
      where a.id = ratings.application_id
        and a.worker_id = (select auth.uid())
        and a.status = 'completed'
        and m.structure_id = ratings.structure_id
    )
  );

drop policy if exists "ratings: structure rates worker on completed application" on public.ratings;
create policy "ratings: structure rates worker on completed application"
  on public.ratings for insert
  to authenticated
  with check (
    ratings.direction = 'structure_to_worker'
    and public.owns_completed_application(ratings.application_id)
    and exists (
      select 1
      from public.applications a
      join public.missions m on m.id = a.mission_id
      where a.id = ratings.application_id
        and a.status = 'completed'
        and a.worker_id = ratings.worker_id
        and m.structure_id = ratings.structure_id
    )
  );

-- Notes publiques des structures, publiees au debut de la semaine suivante
-- uniquement par lots complets de trois. Un reliquat de un ou deux avis reste
-- masque et rejoint les semaines suivantes. Aucun identifiant de travailleur
-- ou de candidature n'est retourne.
create or replace function public.public_structure_rating_summary(p_structure_ids uuid[])
returns table (structure_id uuid, average numeric, review_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select r.*,
           row_number() over (
             partition by r.structure_id order by r.created_at, r.id
           ) as review_number
    from public.ratings r
    where r.direction = 'worker_to_structure'
      and r.structure_id = any(coalesce(p_structure_ids, array[]::uuid[]))
  ), batched as (
    select ranked.*,
           count(*) over (
             partition by structure_id, ((review_number - 1) / 3)
           ) as batch_size,
           max(created_at) over (
             partition by structure_id, ((review_number - 1) / 3)
           ) as batch_completed_at
    from ranked
  ), released as (
    select *
    from batched
    where batch_size = 3
      and date_trunc('week', batch_completed_at) + interval '7 days'
          <= date_trunc('week', now())
  )
  select released.structure_id,
         round(avg(released.score), 2) as average,
         count(*) as review_count
  from released
  group by released.structure_id
$$;

revoke execute on function public.public_structure_rating_summary(uuid[]) from public, anon;
grant execute on function public.public_structure_rating_summary(uuid[]) to authenticated;

-- Reputation agregee d'un travailleur sans exposer l'identite des structures
-- qui l'ont note.
create or replace function public.worker_public_rating_summary(p_worker_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentification requise.';
  end if;
  return (
    select jsonb_build_object(
      'average', round(avg(r.score), 2),
      'count', count(*)
    )
    from public.ratings r
    where r.worker_id = p_worker_id
      and r.direction = 'structure_to_worker'
  );
end;
$$;

revoke execute on function public.worker_public_rating_summary(uuid) from public, anon;
grant execute on function public.worker_public_rating_summary(uuid) to authenticated;

-- Tableau de bord du proprietaire : resume et commentaires deja publies.
-- Les lignes ne contiennent volontairement ni worker_id, ni application_id,
-- ni mission_id, ni heure exacte de depot.
create or replace function public.structure_weekly_reviews(p_structure_id uuid)
returns table (
  score integer,
  comment text,
  published_week date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_structure_owner(p_structure_id) then
    raise exception using errcode = '42501', message = 'Non autorise.';
  end if;
  return query
  with ranked as (
    select r.*,
           row_number() over (order by r.created_at, r.id) as review_number
    from public.ratings r
    where r.structure_id = p_structure_id
      and r.direction = 'worker_to_structure'
  ), batched as (
    select ranked.*,
           count(*) over (
             partition by ((review_number - 1) / 3)
           ) as batch_size,
           max(created_at) over (
             partition by ((review_number - 1) / 3)
           ) as batch_completed_at
    from ranked
  )
  select batched.score,
         nullif(btrim(batched.comment), ''),
         (date_trunc('week', batched.batch_completed_at) + interval '7 days')::date
  from batched
  where batched.batch_size = 3
    and date_trunc('week', batched.batch_completed_at) + interval '7 days'
        <= date_trunc('week', now())
  order by 3 desc, md5(batched.id::text);
end;
$$;

revoke execute on function public.structure_weekly_reviews(uuid) from public, anon;
grant execute on function public.structure_weekly_reviews(uuid) to authenticated;

-- Historique financier sans donnees personnelles sur les travailleurs.
create or replace function public.structure_mission_history(p_structure_id uuid)
returns table (
  mission_id uuid,
  title text,
  scheduled_date date,
  address text,
  completed_workers bigint,
  worker_paid_cents bigint,
  commission_cents bigint,
  total_expense_cents bigint,
  paid_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_structure_owner(p_structure_id) then
    raise exception using errcode = '42501', message = 'Non autorise.';
  end if;
  return query
  select m.id,
         m.title,
         m.scheduled_date,
         coalesce(nullif(m.address, ''), nullif(m.location, ''), nullif(m.city, '')),
         count(distinct a.id),
         coalesce(sum(p.worker_amount_cents), 0)::bigint,
         coalesce(sum(p.commission_cents), 0)::bigint,
         coalesce(sum(p.amount_cents), 0)::bigint,
         max(p.released_at)
  from public.missions m
  join public.applications a
    on a.mission_id = m.id and a.status = 'completed'
  left join public.payments p on p.application_id = a.id and p.status = 'released'
  where m.structure_id = p_structure_id
  group by m.id, m.title, m.scheduled_date, m.address, m.location, m.city
  order by m.scheduled_date desc, m.id;
end;
$$;

revoke execute on function public.structure_mission_history(uuid) from public, anon;
grant execute on function public.structure_mission_history(uuid) to authenticated;

-- Le RPC historique du tableau de bord respecte lui aussi l'embargo
-- hebdomadaire afin qu'un appel direct ne revele pas une note plus tot.
create or replace function public.structure_stats(p_structure_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not public.is_structure_owner(p_structure_id) then
    raise exception using errcode = '42501', message = 'Non autorise.';
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
      with ranked as (
        select r.*,
               row_number() over (order by r.created_at, r.id) as review_number
        from public.ratings r
        where r.structure_id = p_structure_id
          and r.direction = 'worker_to_structure'
      ), batched as (
        select ranked.*,
               count(*) over (partition by ((review_number - 1) / 3)) as batch_size,
               max(created_at) over (partition by ((review_number - 1) / 3)) as batch_completed_at
        from ranked
      )
      select round(avg(score), 2)
      from batched
      where batch_size = 3
        and date_trunc('week', batch_completed_at) + interval '7 days'
            <= date_trunc('week', now())
    ),
    'ratings_count', (
      with ranked as (
        select r.*,
               row_number() over (order by r.created_at, r.id) as review_number
        from public.ratings r
        where r.structure_id = p_structure_id
          and r.direction = 'worker_to_structure'
      ), batched as (
        select ranked.*,
               count(*) over (partition by ((review_number - 1) / 3)) as batch_size,
               max(created_at) over (partition by ((review_number - 1) / 3)) as batch_completed_at
        from ranked
      )
      select count(*)
      from batched
      where batch_size = 3
        and date_trunc('week', batch_completed_at) + interval '7 days'
            <= date_trunc('week', now())
    )
  )
  into v
  from public.missions m
  where m.structure_id = p_structure_id;

  return v;
end;
$$;

revoke execute on function public.structure_stats(uuid) from public, anon;
grant execute on function public.structure_stats(uuid) to authenticated;

-- Une note structure n'est plus annoncee immediatement : ce signal temporel
-- permettrait d'identifier son auteur. Elle apparait un lundi uniquement quand
-- un lot de trois est complet. Les notes recues par un travailleur restent
-- notifiees.
create or replace function public.trg_notify_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'structure_to_worker' then
    perform public.notify(
      new.worker_id, 'rating',
      'Nouvelle note sur ton CV vivant',
      'Une structure a ajoute une note a ton CV vivant.',
      jsonb_build_object('application_id', new.application_id)
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_notify_rating() from public, anon, authenticated;
