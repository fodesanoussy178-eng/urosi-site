-- Exception Fondateur / test : permet de PREVISUALISER immediatement, en
-- mode Fondateur uniquement, l'affichage public d'une evaluation encore en
-- attente (utile pour verifier de bout en bout le rendu d'une note/avis sans
-- attendre le seuil de 3 avis ou le delai de 48h/6h).
--
-- Portee volontairement etroite et sans danger pour la regle publique reelle :
--   - un booleen PAR NOTE (jamais global, jamais par structure/travailleur) ;
--   - defaut false partout : aucune note existante n'est affectee ;
--   - ne modifie jamais scheduled_publish_at (la vraie date prevue reste
--     affichee telle quelle, la note est seulement affichee EN PLUS, tot) ;
--   - reversible a tout moment (action inverse "unforce_test_preview" =
--     reinitialisation du test) ;
--   - action de moderation a part entiere : motif obligatoire, toujours
--     journalisee dans founder_admin_log, jamais de modification silencieuse.
alter table public.ratings add column if not exists test_force_visible boolean not null default false;

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
           r.score, r.comment, r.created_at, r.is_hidden, r.test_force_visible,
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
    (not b.is_hidden) and (
      b.test_force_visible or now() >= (
        case when b.created_at <= a.activates_at then a.activates_at else b.created_at + interval '6 hours' end
      )
    ) as counted
  from base b
  join activation a on a.subject_id = b.subject_id
$$;

revoke execute on function private.rating_visibility(text) from public, anon, authenticated;

-- founder_ratings_list : expose test_force_visible pour que le panneau
-- Fondateur affiche clairement le badge "affichage force (test)".
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
        r.test_force_visible,
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

-- founder_moderate_rating : deux nouvelles actions symetriques,
-- force_test_preview / unforce_test_preview ("reinitialiser le test"),
-- memes garanties que hide/cancel/flag (motif obligatoire, toujours
-- journalisee, jamais de modification silencieuse).
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

  if p_action not in (
    'hide', 'unhide', 'cancel', 'uncancel', 'flag', 'unflag',
    'force_test_preview', 'unforce_test_preview'
  ) then
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
      test_force_visible = case p_action
        when 'force_test_preview' then true
        when 'unforce_test_preview' then false
        else test_force_visible
      end,
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
