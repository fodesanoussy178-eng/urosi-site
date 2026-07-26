-- Hotfix production : le frontend deploye (main, PR #63) attend deja le
-- schema du Document 4, absent de cette base. Consequence observee dans les
-- logs : POST/GET /rest/v1/missions -> 400 "column missions.archived_at does
-- not exist" (publication de mission cassee), et RPC structure_mission_history
-- appelee avec un 2e parametre inexistant -> 404. Reprise verbatim de la
-- migration deja validee sur staging (20260723110000), purement additive,
-- aucune regle metier modifiee.

alter table public.missions
  add column if not exists archived_at timestamptz;

create index if not exists missions_archived_idx
  on public.missions (structure_id)
  where archived_at is not null;

create or replace function public.guard_mission_lifecycle()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare
  v_backend boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or coalesce(current_setting('app.mission_trusted_write', true), '') = 'true';
begin
  if tg_op = 'DELETE' then
    if not v_backend and (
      old.status <> 'open'
      or exists (select 1 from public.applications a where a.mission_id = old.id)
      or exists (
        select 1 from public.payments p
        join public.applications a on a.id = p.application_id
        where a.mission_id = old.id
      )
    ) then
      raise exception using errcode = '23514',
        message = 'Une mission engagee ou terminee ne peut pas etre supprimee.';
    end if;
    return old;
  end if;

  if new.structure_id is distinct from old.structure_id then
    raise exception using errcode = '23514', message = 'La structure d une mission est immuable.';
  end if;
  if not v_backend and old.status in ('closed', 'cancelled') and new is distinct from old then
    raise exception using errcode = '23514', message = 'Une mission terminee est en lecture seule.';
  end if;
  return new;
end;
$function$;

create or replace function public.archive_mission(p_mission_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_structure uuid;
begin
  select structure_id into v_structure from public.missions where id = p_mission_id;
  if v_structure is null then
    raise exception using errcode = 'P0002', message = 'Mission introuvable.';
  end if;
  if not public.is_structure_owner(v_structure) then
    raise exception using errcode = '42501', message = 'Non autorisé.';
  end if;
  if exists (
    select 1 from public.applications a
    where a.mission_id = p_mission_id
      and a.status in ('pending', 'accepted', 'in_progress', 'payment_pending', 'disputed')
  ) then
    raise exception using errcode = '23514',
      message = 'Une mission avec une candidature active ne peut pas être archivée.';
  end if;

  perform set_config('app.mission_trusted_write', 'true', true);
  update public.missions set archived_at = now() where id = p_mission_id;
end;
$$;

create or replace function public.unarchive_mission(p_mission_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_structure uuid;
begin
  select structure_id into v_structure from public.missions where id = p_mission_id;
  if v_structure is null then
    raise exception using errcode = 'P0002', message = 'Mission introuvable.';
  end if;
  if not public.is_structure_owner(v_structure) then
    raise exception using errcode = '42501', message = 'Non autorisé.';
  end if;

  perform set_config('app.mission_trusted_write', 'true', true);
  update public.missions set archived_at = null where id = p_mission_id;
end;
$$;

drop function if exists public.structure_mission_history(uuid);
create function public.structure_mission_history(
  p_structure_id uuid,
  p_include_archived boolean default false
)
returns table(
  mission_id uuid, title text, scheduled_date date, address text,
  completed_workers bigint, worker_paid_cents bigint, commission_cents bigint,
  total_expense_cents bigint, paid_at timestamptz, archived_at timestamptz
)
language plpgsql stable security definer set search_path to ''
as $function$
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
         max(p.released_at),
         m.archived_at
  from public.missions m
  join public.applications a
    on a.mission_id = m.id and a.status = 'completed'
  left join public.payments p on p.application_id = a.id and p.status = 'released'
  where m.structure_id = p_structure_id
    and (p_include_archived or m.archived_at is null)
  group by m.id, m.title, m.scheduled_date, m.address, m.location, m.city, m.archived_at
  order by m.scheduled_date desc, m.id;
end;
$function$;

create or replace function private.finalize_mission_end(p_application_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v record;
begin
  select a.id, a.worker_id, a.mission_id, a.cv_status, s.owner_id, m.title
  into v
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = p_application_id
  for update of a;

  if not found or v.cv_status is not null then
    return;
  end if;

  update public.applications
  set conversation_status = 'closed',
      cv_status = 'pending_verification'
  where id = p_application_id;

  insert into public.rating_requests (application_id, mission_id, direction, reviewer_id)
  values
    (p_application_id, v.mission_id, 'worker_to_structure', v.worker_id),
    (p_application_id, v.mission_id, 'structure_to_worker', v.owner_id)
  on conflict (application_id, direction) do nothing;

  perform public.notify(
    v.worker_id, 'cv_updated', 'Mission ajoutée à ton CV',
    '« ' || v.title || ' » a rejoint ton CV vivant (en cours de vérification).',
    jsonb_build_object('application_id', p_application_id, 'mission_id', v.mission_id)
  );

  perform public.notify(
    v.worker_id, 'rating_request', 'Mission terminée',
    'Comment s''est passée ta mission « ' || v.title || ' » ? Ton avis nous aide.',
    jsonb_build_object('application_id', p_application_id, 'direction', 'worker_to_structure')
  );
  perform public.notify(
    v.owner_id, 'rating_request', 'Mission terminée',
    'Comment s''est passée la mission « ' || v.title || ' » avec ton salarié ? Donne ton avis.',
    jsonb_build_object('application_id', p_application_id, 'direction', 'structure_to_worker')
  );
end;
$$;

-- Grant manquant (present sur staging, absent en prod) : la policy RLS
-- "reviewer reads own" restreint deja aux lignes de l'appelant ; sans ce
-- grant, PostgREST renvoie 403 avant meme d'evaluer la policy.
grant select on public.rating_requests to authenticated;