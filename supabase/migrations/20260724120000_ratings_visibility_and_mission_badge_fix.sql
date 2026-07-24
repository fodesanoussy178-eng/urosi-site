-- Audit de 3 écarts réels (aucune règle métier existante retirée : la
-- publication mutuelle des avis, le délai d'auto-publication à 7 jours et la
-- fermeture de messagerie à la fin de mission restent inchangés) :
--
-- 1. Badge « missions publiées » : comptait aussi les missions ANNULÉES
--    (jamais réellement exécutées), gonflant le badge d'une structure sans
--    mission active (repro confirmée : 4 annulées + 3 ouvertes -> badge à 7
--    au lieu de 3). Exclut désormais status='cancelled'.
--
-- 2. Moyenne/nombre d'avis affichés à la structure elle-même (structure_stats)
--    et aux travailleurs (public_structure_rating_summary) : n'apparaissaient
--    qu'après un arrondi à la semaine ET un lot COMPLET de 3 avis -> avec 1 ou
--    2 avis publiés, rien ne s'affichait jamais. Remplacé par une règle
--    simple : la moyenne apparaît dès le premier avis publié, 5 jours pleins
--    après avoir été donné (anti-représailles : la structure ne voit pas une
--    note toute fraîche).
--
-- 3. Nouvelle RPC dédiée aux COMMENTAIRES (public_structure_reviews),
--    jusqu'ici absente : aucun identifiant d'auteur exposé (jamais worker_id
--    ni nom), et publiés uniquement par lots COMPLETS d'au moins 3 avis,
--    chaque lot soumis au même délai de 5 jours depuis son dernier avis.
--    Avec moins de 3 avis, aucun commentaire n'est jamais renvoyé (seule la
--    moyenne du point 2 est disponible).

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
    'missions_total', count(*) filter (where m.status <> 'cancelled'),
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
      select round(avg(r.score), 2)
      from public.ratings r
      where r.structure_id = p_structure_id
        and r.direction = 'worker_to_structure'
        and r.status = 'published'
        and r.created_at <= now() - interval '5 days'
    ),
    'ratings_count', (
      select count(*)
      from public.ratings r
      where r.structure_id = p_structure_id
        and r.direction = 'worker_to_structure'
        and r.status = 'published'
        and r.created_at <= now() - interval '5 days'
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

create or replace function public.public_structure_rating_summary(p_structure_ids uuid[])
returns table (structure_id uuid, average numeric, review_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select r.structure_id,
         round(avg(r.score), 2) as average,
         count(*) as review_count
  from public.ratings r
  where r.direction = 'worker_to_structure'
    and r.status = 'published'
    and r.created_at <= now() - interval '5 days'
    and r.structure_id = any(coalesce(p_structure_ids, array[]::uuid[]))
  group by r.structure_id
$$;

-- Commentaires anonymisés : jamais de worker_id/nom exposé, publiés
-- uniquement par lots complets d'au moins 3 avis, chaque lot devant en plus
-- avoir 5 jours pleins depuis son dernier avis.
create or replace function public.public_structure_reviews(p_structure_id uuid, p_limit integer default 3)
returns table (score integer, comment text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select r.score, r.comment, r.created_at,
           row_number() over (order by r.created_at, r.id) as review_number
    from public.ratings r
    where r.structure_id = p_structure_id
      and r.direction = 'worker_to_structure'
      and r.status = 'published'
  ), batched as (
    select ranked.*,
           count(*) over (partition by ((review_number - 1) / 3)) as batch_size,
           max(created_at) over (partition by ((review_number - 1) / 3)) as batch_completed_at
    from ranked
  )
  select batched.score, batched.comment, batched.created_at
  from batched
  where batch_size >= 3
    and batch_completed_at <= now() - interval '5 days'
    and batched.comment is not null
  order by batched.created_at desc
  limit greatest(1, least(coalesce(p_limit, 3), 20));
$$;

revoke execute on function public.public_structure_reviews(uuid, integer) from public, anon;
grant execute on function public.public_structure_reviews(uuid, integer) to authenticated;
