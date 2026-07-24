-- Document 4 — archivage des missions + notification CV.
--
-- ARCHIVAGE : une mission terminée peut être archivée. L'archivage la masque
-- des listes principales (accueil, historique par défaut) mais conserve toutes
-- les données. Une mission avec une candidature encore active ne peut pas être
-- archivée. La suppression reste interdite dès qu'il existe paiement / pointage
-- / avis (guard_mission_lifecycle, inchangé) : archiver est la seule voie.
--
-- NOTIFICATION CV : à la fin de mission, le travailleur est prévenu que la
-- mission a été ajoutée à son CV vivant (en cours de vérification).

alter table public.missions
  add column if not exists archived_at timestamptz;

create index if not exists missions_archived_idx
  on public.missions (structure_id)
  where archived_at is not null;

-- Le garde du cycle de vie tolère une écriture « de confiance » posée
-- uniquement par les RPC d'archivage (mêmes règles que le drapeau
-- notifications) : sans lui, archiver une mission déjà clôturée serait bloqué
-- par la lecture seule.
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

-- Historique : exclut les missions archivées par défaut ; p_include_archived
-- permet de consulter l'archive. Ajoute archived_at à la sortie.
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

-- Fin de mission : prévient aussi le travailleur que la mission a rejoint son
-- CV vivant (en cours de vérification).
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
    return; -- deja finalisee : ne rien refaire (idempotence).
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
