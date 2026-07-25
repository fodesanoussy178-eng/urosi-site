-- Systeme bilateral d'evaluation 5 etoiles (travailleurs <-> structures).
--
-- Regle publique, IDENTIQUE dans les deux sens (worker_to_structure et
-- structure_to_worker) :
--   - une evaluation est enregistree immediatement (insert normal, deja en
--     place) ;
--   - les 2 premieres evaluations d'un sujet (structure ou travailleur)
--     restent invisibles publiquement ;
--   - des la 3e, la moyenne + le nombre d'avis s'affichent immediatement ;
--   - si le sujet reste sous 3 avis, publication automatique du/des avis en
--     attente 48h apres la toute premiere evaluation recue ;
--   - une fois l'affichage active, chaque NOUVELLE evaluation attend 6h
--     avant d'etre integree a la moyenne publique (les evaluations deja
--     comptees au moment de l'activation, elles, s'affichent tout de suite) ;
--   - jamais de note individuelle isolee affichee (toujours moyenne+nombre,
--     jamais une fiche "voici LA note de untel").
--
-- Ce mecanisme est INDEPENDANT du systeme existant ratings.status
-- (pending/published), qui gere une question differente : quand la
-- CONTREPARTIE (l'autre participant de la meme mission) peut voir ce qu'on a
-- ecrit sur elle (anti-representailles 1:1). Les deux coexistent sans se
-- gener : ratings.status n'est pas touche par cette migration.
--
-- Cote Fondateur : acces immediat et brut a tout (jamais de delai), moyenne
-- interne recalculee en direct, et 3 actions de moderation (masquer/annuler/
-- signaler) avec motif obligatoire, chacune journalisee dans
-- founder_admin_log (jamais de modification silencieuse).

-- ---------------------------------------------------------------------------
-- 1. Colonnes de moderation (jamais posees par un client : uniquement par la
--    RPC founder_moderate_rating, reservee au fondateur).
-- ---------------------------------------------------------------------------
alter table public.ratings add column if not exists is_hidden boolean not null default false;
alter table public.ratings add column if not exists is_cancelled boolean not null default false;
alter table public.ratings add column if not exists is_flagged boolean not null default false;
alter table public.ratings add column if not exists moderation_reason text;
alter table public.ratings add column if not exists moderated_by uuid references public.profiles (id) on delete set null;
alter table public.ratings add column if not exists moderated_at timestamptz;

create index if not exists ratings_direction_created_idx on public.ratings (direction, created_at);

-- ---------------------------------------------------------------------------
-- 2. Coeur du calcul de visibilite publique. Une seule fonction pour les deux
--    sens (parametree par p_direction) : garantit la meme regle partout,
--    aucune duplication de logique.
-- ---------------------------------------------------------------------------
create or replace function private.rating_visibility(p_direction text)
returns table (
  rating_id uuid,
  subject_id uuid,
  score integer,
  comment text,
  created_at timestamptz,
  is_hidden boolean,
  scheduled_publish_at timestamptz,
  counted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select r.id,
           case when p_direction = 'worker_to_structure' then r.structure_id else r.worker_id end as subject_id,
           r.score, r.comment, r.created_at, r.is_hidden,
           row_number() over (
             partition by case when p_direction = 'worker_to_structure' then r.structure_id else r.worker_id end
             order by r.created_at, r.id
           ) as rn
    from public.ratings r
    where r.direction = p_direction
      and not r.is_cancelled
  ),
  anchors as (
    select subject_id,
           min(created_at) as first_created_at,
           min(created_at) filter (where rn = 3) as third_created_at
    from base
    group by subject_id
  ),
  activation as (
    select subject_id,
           least(coalesce(third_created_at, 'infinity'::timestamptz), first_created_at + interval '48 hours') as activates_at
    from anchors
  )
  select
    b.id,
    b.subject_id,
    b.score,
    b.comment,
    b.created_at,
    b.is_hidden,
    case when b.created_at <= a.activates_at then a.activates_at else b.created_at + interval '6 hours' end as scheduled_publish_at,
    (not b.is_hidden) and now() >= (
      case when b.created_at <= a.activates_at then a.activates_at else b.created_at + interval '6 hours' end
    ) as counted
  from base b
  join activation a on a.subject_id = b.subject_id
$$;

revoke execute on function private.rating_visibility(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. RPC publiques (workers + structures) reconstruites sur la regle unique.
--    Remplacent l'ancien delai de 5 jours par avis / lot de 3 uniquement pour
--    les commentaires / 7 jours de publication automatique cote status.
-- ---------------------------------------------------------------------------
create or replace function public.public_structure_rating_summary(p_structure_ids uuid[])
returns table (structure_id uuid, average numeric, review_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select subject_id, round(avg(score), 2) as average, count(*) as review_count
  from private.rating_visibility('worker_to_structure')
  where counted and subject_id = any(coalesce(p_structure_ids, array[]::uuid[]))
  group by subject_id
$$;

revoke execute on function public.public_structure_rating_summary(uuid[]) from public, anon;
grant execute on function public.public_structure_rating_summary(uuid[]) to authenticated;

create or replace function public.public_structure_reviews(p_structure_id uuid, p_limit integer default 3)
returns table (score integer, comment text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select score, comment, created_at
  from private.rating_visibility('worker_to_structure')
  where counted and subject_id = p_structure_id and comment is not null
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 3), 20))
$$;

revoke execute on function public.public_structure_reviews(uuid, integer) from public, anon;
grant execute on function public.public_structure_reviews(uuid, integer) to authenticated;

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
    select jsonb_build_object('average', round(avg(score), 2), 'count', count(*))
    from private.rating_visibility('structure_to_worker')
    where counted and subject_id = p_worker_id
  );
end;
$$;

revoke execute on function public.worker_public_rating_summary(uuid) from public, anon;
grant execute on function public.worker_public_rating_summary(uuid) to authenticated;

-- Symetrie complete : commentaires anonymises cote travailleur (CV vivant),
-- pas encore consommee par le frontend mais construite des maintenant pour
-- garantir "exactement la meme regle" des deux cotes.
create or replace function public.public_worker_reviews(p_worker_id uuid, p_limit integer default 3)
returns table (score integer, comment text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select score, comment, created_at
  from private.rating_visibility('structure_to_worker')
  where counted and subject_id = p_worker_id and comment is not null
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 3), 20))
$$;

revoke execute on function public.public_worker_reviews(uuid, integer) from public, anon;
grant execute on function public.public_worker_reviews(uuid, integer) to authenticated;

-- structure_stats (tableau de bord du proprietaire) : la structure voit sa
-- propre moyenne selon exactement la meme regle qu'un tiers, jamais avant.
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
      select round(avg(score), 2) from private.rating_visibility('worker_to_structure')
      where counted and subject_id = p_structure_id
    ),
    'ratings_count', (
      select count(*) from private.rating_visibility('worker_to_structure')
      where counted and subject_id = p_structure_id
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

-- Historique "avis" du tableau de bord structure : meme regle, remplace le
-- regroupement hebdomadaire fixe par lot de 3. published_week est conserve
-- (cle d'affichage existante côté frontend) mais derive desormais de la date
-- reelle de publication effective de chaque avis.
create or replace function public.structure_weekly_reviews(p_structure_id uuid)
returns table (score integer, comment text, published_week date)
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
  select v.score, v.comment, date_trunc('week', v.scheduled_publish_at)::date
  from private.rating_visibility('worker_to_structure') v
  where v.counted and v.subject_id = p_structure_id
  order by v.scheduled_publish_at desc, md5(v.rating_id::text);
end;
$$;

revoke execute on function public.structure_weekly_reviews(uuid) from public, anon;
grant execute on function public.structure_weekly_reviews(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Cote Fondateur : acces brut immediat + moderation.
-- ---------------------------------------------------------------------------
create or replace function public.founder_ratings_list(
  p_direction text default null,
  p_status text default null,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_founder();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (
      select
        r.id,
        r.direction,
        r.score,
        r.comment,
        r.created_at,
        r.is_hidden,
        r.is_cancelled,
        r.is_flagged,
        r.moderation_reason,
        r.moderated_at,
        mb.full_name as moderated_by_name,
        m.id as mission_id,
        m.title as mission_title,
        author.full_name as author_name,
        r.structure_id,
        s.name as structure_name,
        r.worker_id,
        w.full_name as worker_name,
        coalesce(vw.counted, vs.counted, false) as is_publicly_visible,
        coalesce(vw.scheduled_publish_at, vs.scheduled_publish_at) as scheduled_publish_at
      from public.ratings r
      join public.applications a on a.id = r.application_id
      join public.missions m on m.id = a.mission_id
      join public.structures s on s.id = m.structure_id
      join public.profiles w on w.id = r.worker_id
      left join public.profiles author on author.id = r.reviewer_id
      left join public.profiles mb on mb.id = r.moderated_by
      left join private.rating_visibility('worker_to_structure') vw
        on r.direction = 'worker_to_structure' and vw.rating_id = r.id
      left join private.rating_visibility('structure_to_worker') vs
        on r.direction = 'structure_to_worker' and vs.rating_id = r.id
      where (p_direction is null or r.direction = p_direction)
        and (
          p_status is null
          or (p_status = 'cancelled' and r.is_cancelled)
          or (p_status = 'hidden' and r.is_hidden and not r.is_cancelled)
          or (p_status = 'flagged' and r.is_flagged and not r.is_cancelled)
          or (p_status = 'visible' and coalesce(vw.counted, vs.counted, false) and not r.is_hidden and not r.is_cancelled)
          or (p_status = 'pending' and not coalesce(vw.counted, vs.counted, false) and not r.is_hidden and not r.is_cancelled)
        )
      order by r.created_at desc
      limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.founder_ratings_list(text, text, integer) from public, anon, authenticated;
grant execute on function public.founder_ratings_list(text, text, integer) to authenticated;

-- Moyenne interne temps reel pour un sujet donne : jamais retardee, jamais
-- filtree par le statut de publication (seules les notes ANNULEES en sont
-- exclues — annuler = considerer que la note n'aurait jamais du exister).
create or replace function public.founder_rating_subject_stats(p_direction text, p_subject_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_col text;
begin
  perform private.assert_founder();
  if p_direction not in ('worker_to_structure', 'structure_to_worker') then
    raise exception using errcode = '22023', message = 'Direction invalide.';
  end if;

  return (
    select jsonb_build_object(
      'average', round(avg(r.score), 2),
      'count', count(*),
      'hidden_count', count(*) filter (where r.is_hidden),
      'flagged_count', count(*) filter (where r.is_flagged),
      'cancelled_count', (
        select count(*) from public.ratings rc
        where rc.direction = p_direction and rc.is_cancelled
          and (case when p_direction = 'worker_to_structure' then rc.structure_id else rc.worker_id end) = p_subject_id
      )
    )
    from public.ratings r
    where r.direction = p_direction
      and not r.is_cancelled
      and (case when p_direction = 'worker_to_structure' then r.structure_id else r.worker_id end) = p_subject_id
  );
end;
$$;

revoke execute on function public.founder_rating_subject_stats(text, uuid) from public, anon, authenticated;
grant execute on function public.founder_rating_subject_stats(text, uuid) to authenticated;

-- Moderation : masquer/annuler/signaler (et leurs inverses), motif
-- obligatoire a chaque appel, toujours journalise — jamais de modification
-- silencieuse d'une note.
create or replace function public.founder_moderate_rating(p_rating_id uuid, p_action text, p_reason text)
returns public.ratings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ratings;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_mission_title text;
begin
  perform private.assert_founder();

  if p_action not in ('hide', 'unhide', 'cancel', 'uncancel', 'flag', 'unflag') then
    raise exception using errcode = '22023', message = 'Action de moderation invalide.';
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = 'Un motif est requis.';
  end if;

  select * into v_row from public.ratings where id = p_rating_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Evaluation introuvable.';
  end if;

  update public.ratings
  set is_hidden = case p_action when 'hide' then true when 'unhide' then false else is_hidden end,
      is_cancelled = case p_action when 'cancel' then true when 'uncancel' then false else is_cancelled end,
      is_flagged = case p_action when 'flag' then true when 'unflag' then false else is_flagged end,
      moderation_reason = v_reason,
      moderated_by = auth.uid(),
      moderated_at = now()
  where id = p_rating_id
  returning * into v_row;

  select m.title into v_mission_title
  from public.applications a
  join public.missions m on m.id = a.mission_id
  where a.id = v_row.application_id;

  perform private.log_founder_action(
    'rating_' || p_action,
    'rating',
    p_rating_id,
    v_mission_title,
    jsonb_build_object('reason', v_reason, 'direction', v_row.direction, 'score', v_row.score)
  );

  return v_row;
end;
$$;

revoke execute on function public.founder_moderate_rating(uuid, text, text) from public, anon, authenticated;
grant execute on function public.founder_moderate_rating(uuid, text, text) to authenticated;
