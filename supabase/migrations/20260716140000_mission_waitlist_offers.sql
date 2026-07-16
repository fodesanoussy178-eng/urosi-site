-- Liste d'attente et redistribution des places apres annulation.
-- Specification validee le 16/07/2026 (docs/notes/file-attente-annulation.md) :
--   1. Une mission accepte au plus (places + 3) candidatures actives : les
--      candidatures au-dela des places forment la file d'attente (statut
--      'pending' existant, ordre d'arrivee).
--   2. Quand un candidat ACCEPTE annule (par le travailleur lui-meme) :
--      - la structure est prevenue immediatement (notification) ;
--      - l'annulation est journalisee dans reliability_events SANS sanction
--        (weight 0, statut 'pending') tant que les regles metier ne sont pas
--        figees ;
--      - la place est proposee au premier candidat en attente via une offre
--        a confirmer sous 2 minutes — JAMAIS d'acceptation automatique.
--   3. Refus ou expiration => candidat suivant. Personne en attente =>
--      la mission est remise en avant (requeued_at touche => flux realtime).
--   4. L'expiration est traitee par la tache planifiee
--      supabase/functions/process-spot-offers (service_role, cadence 1 min).
--      Aucun pg_sleep, aucune attente en base.
-- La garde de capacite existante n'est pas affaiblie : la confirmation d'une
-- offre passe par la transition pending -> accepted qui reste soumise a
-- guard_application_state_and_capacity (capacite, mission ouverte).

-- ---------------------------------------------------------------------------
-- Evenement de fiabilite dedie, sans poids.
-- ---------------------------------------------------------------------------
alter table public.reliability_events drop constraint if exists reliability_events_event_type_check;
alter table public.reliability_events
  add constraint reliability_events_event_type_check
  check (event_type in (
    'presence_confirmed', 'mission_completed', 'delay_reported', 'delay_confirmed',
    'absence_reported', 'absence_confirmed', 'early_departure_reported',
    'mission_disputed', 'report_opened', 'report_resolved',
    'mission_cancelled_by_worker'
  ));

-- Remise en avant : toucher cette colonne suffit a reveiller le flux
-- realtime missions-feed cote travailleurs (aucun tri modifie cote UI).
alter table public.missions add column if not exists requeued_at timestamptz;

-- ---------------------------------------------------------------------------
-- Offres de place : acces RPC uniquement (deny-all, comme les tables
-- mission_validation_*).
-- ---------------------------------------------------------------------------
create table if not exists public.mission_spot_offers (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  worker_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mission_spot_offers_due_idx
  on public.mission_spot_offers (expires_at) where status = 'pending';
create index if not exists mission_spot_offers_mission_idx
  on public.mission_spot_offers (mission_id);
create unique index if not exists mission_spot_offers_one_pending_per_application
  on public.mission_spot_offers (application_id) where status = 'pending';

alter table public.mission_spot_offers enable row level security;
revoke all on table public.mission_spot_offers from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Coeur : proposer la place liberee au prochain candidat en attente.
-- ---------------------------------------------------------------------------
create or replace function private.offer_spot_to_next(p_mission_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission record;
  v_capacity integer;
  v_committed integer;
  v_next record;
  v_offer_id uuid;
begin
  select m.id, m.status, m.title, m.positions, m.places, s.owner_id
  into v_mission
  from public.missions m
  join public.structures s on s.id = m.structure_id
  where m.id = p_mission_id
  for update of m;

  if not found or v_mission.status <> 'open' then
    return null;
  end if;

  v_capacity := coalesce(nullif(v_mission.positions, 0), nullif(v_mission.places, 0), 1);
  select count(*) into v_committed
  from public.applications a
  where a.mission_id = p_mission_id
    and a.status in ('accepted', 'in_progress', 'payment_pending', 'completed', 'disputed');
  if v_committed >= v_capacity then
    return null;
  end if;

  -- Premier candidat en attente sans offre active ni offre deja refusee ou
  -- expiree sur cette mission.
  select a.id, a.worker_id
  into v_next
  from public.applications a
  where a.mission_id = p_mission_id
    and a.status = 'pending'
    and not exists (
      select 1 from public.mission_spot_offers o
      where o.application_id = a.id
        and o.status in ('pending', 'declined', 'expired')
    )
  order by a.created_at asc
  limit 1;

  if not found then
    update public.missions set requeued_at = now() where id = p_mission_id;
    perform public.notify(
      v_mission.owner_id, 'waitlist', 'File d attente vide',
      'Aucun candidat en attente pour « ' || v_mission.title || ' ». La mission est remise en avant dans le flux des travailleurs.',
      jsonb_build_object('mission_id', p_mission_id)
    );
    return null;
  end if;

  insert into public.mission_spot_offers (mission_id, application_id, worker_id, expires_at)
  values (p_mission_id, v_next.id, v_next.worker_id, now() + interval '2 minutes')
  returning id into v_offer_id;

  perform public.notify(
    v_next.worker_id, 'spot_offer', 'Une place s est liberee',
    'Une place est disponible sur « ' || v_mission.title || ' ». Confirme dans les 2 minutes depuis ton espace.',
    jsonb_build_object('offer_id', v_offer_id, 'mission_id', p_mission_id,
      'application_id', v_next.id, 'expires_at', now() + interval '2 minutes')
  );
  perform public.notify(
    v_mission.owner_id, 'waitlist', 'Place proposee a la file d attente',
    'La place liberee sur « ' || v_mission.title || ' » est proposee au premier candidat en attente (2 minutes pour confirmer).',
    jsonb_build_object('mission_id', p_mission_id, 'offer_id', v_offer_id)
  );

  return v_offer_id;
end;
$$;

revoke execute on function private.offer_spot_to_next(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reaction a l'annulation d'un candidat.
-- ---------------------------------------------------------------------------
create or replace function private.handle_application_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  -- Une candidature qui quitte la file (retrait ou refus) libere son offre
  -- active eventuelle et fait avancer la file.
  if old.status = 'pending' and new.status in ('cancelled', 'rejected') then
    update public.mission_spot_offers
    set status = 'cancelled', decided_at = now()
    where application_id = old.id and status = 'pending';
    if found then
      perform private.offer_spot_to_next(old.mission_id);
    end if;
    return new;
  end if;

  -- Annulation d'un candidat accepte, par le travailleur lui-meme.
  if old.status <> 'accepted' or new.status <> 'cancelled' then
    return new;
  end if;
  if (select auth.uid()) is distinct from old.worker_id then
    return new;
  end if;

  select m.title, s.owner_id, p.full_name
  into v
  from public.missions m
  join public.structures s on s.id = m.structure_id
  left join public.profiles p on p.id = old.worker_id
  where m.id = old.mission_id;
  if not found then
    return new;
  end if;

  perform public.notify(
    v.owner_id, 'application_cancelled', 'Un candidat a annule',
    coalesce(v.full_name, 'Un travailleur') || ' a annule sa participation a « ' || v.title ||
      ' ». UROSI propose la place a la file d attente.',
    jsonb_build_object('mission_id', old.mission_id, 'application_id', old.id)
  );

  -- Journal de fiabilite : trace SANS sanction automatique (weight 0),
  -- les regles metier de penalite ne sont pas encore figees.
  insert into public.reliability_events (
    subject_type, subject_id, mission_id, application_id,
    event_type, status, source, weight, metadata
  ) values (
    'worker', old.worker_id, old.mission_id, old.id,
    'mission_cancelled_by_worker', 'pending', 'system', 0,
    jsonb_build_object('sanction', 'none', 'reason', 'regles de penalite non figees')
  );

  perform private.offer_spot_to_next(old.mission_id);
  return new;
end;
$$;

revoke execute on function private.handle_application_cancellation()
  from public, anon, authenticated;

drop trigger if exists applications_waitlist_on_cancellation on public.applications;
create trigger applications_waitlist_on_cancellation
  after update of status on public.applications
  for each row execute function private.handle_application_cancellation();

-- ---------------------------------------------------------------------------
-- Reponse du travailleur a une offre (confirmation JAMAIS automatique).
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_spot_offer(p_offer_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Connexion requise.';
  end if;

  select o.id, o.status, o.expires_at, o.mission_id, o.application_id, o.worker_id,
         m.title, s.owner_id, p.full_name
  into v
  from public.mission_spot_offers o
  join public.missions m on m.id = o.mission_id
  join public.structures s on s.id = m.structure_id
  left join public.profiles p on p.id = o.worker_id
  where o.id = p_offer_id
  for update of o;

  if not found or v.worker_id <> (select auth.uid()) then
    return jsonb_build_object('state', 'not_found');
  end if;
  if v.status <> 'pending' then
    return jsonb_build_object('state', 'already_handled', 'status', v.status);
  end if;

  if v.expires_at <= now() then
    update public.mission_spot_offers set status = 'expired', decided_at = now() where id = v.id;
    perform private.offer_spot_to_next(v.mission_id);
    return jsonb_build_object('state', 'expired');
  end if;

  if not p_accept then
    update public.mission_spot_offers set status = 'declined', decided_at = now() where id = v.id;
    perform private.offer_spot_to_next(v.mission_id);
    return jsonb_build_object('state', 'declined');
  end if;

  -- Confirmation : la transition pending -> accepted reste soumise a la
  -- garde de capacite existante (mission ouverte, places disponibles).
  begin
    update public.applications
    set status = 'accepted'
    where id = v.application_id and status = 'pending';
    if not found then
      update public.mission_spot_offers set status = 'cancelled', decided_at = now() where id = v.id;
      return jsonb_build_object('state', 'application_not_pending');
    end if;
  exception when others then
    -- Capacite pleine ou mission fermee entre-temps : l'offre tombe.
    update public.mission_spot_offers set status = 'cancelled', decided_at = now() where id = v.id;
    return jsonb_build_object('state', 'capacity_full');
  end;

  update public.mission_spot_offers set status = 'accepted', decided_at = now() where id = v.id;
  perform public.notify(
    v.owner_id, 'waitlist', 'Place confirmee',
    coalesce(v.full_name, 'Un candidat') || ' a confirme la place liberee sur « ' || v.title || ' ».',
    jsonb_build_object('mission_id', v.mission_id, 'application_id', v.application_id)
  );
  return jsonb_build_object('state', 'accepted', 'application_id', v.application_id);
end;
$$;

revoke execute on function public.respond_to_spot_offer(uuid, boolean) from public, anon;
grant execute on function public.respond_to_spot_offer(uuid, boolean) to authenticated;

-- Offres actives du travailleur connecte (la table reste deny-all).
create or replace function public.list_my_spot_offers()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'mission_id', o.mission_id,
    'application_id', o.application_id,
    'expires_at', o.expires_at,
    'mission_title', m.title,
    'city', m.city,
    'scheduled_date', m.scheduled_date,
    'start_time', m.start_time
  ) order by o.expires_at asc), '[]'::jsonb)
  from public.mission_spot_offers o
  join public.missions m on m.id = o.mission_id
  where o.worker_id = (select auth.uid())
    and o.status = 'pending'
    and o.expires_at > now();
$$;

revoke execute on function public.list_my_spot_offers() from public, anon;
grant execute on function public.list_my_spot_offers() to authenticated;

-- ---------------------------------------------------------------------------
-- Expiration planifiee (appelee par supabase/functions/process-spot-offers,
-- cadence 1 minute, service_role). Jamais de pg_sleep.
-- ---------------------------------------------------------------------------
create or replace function public.expire_overdue_spot_offers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  if auth.uid() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Execution reservee au backend UROSI.';
  end if;

  for r in
    select o.id, o.mission_id, o.worker_id
    from public.mission_spot_offers o
    where o.status = 'pending' and o.expires_at <= now()
    order by o.created_at asc
    for update skip locked
  loop
    update public.mission_spot_offers set status = 'expired', decided_at = now() where id = r.id;
    perform public.notify(
      r.worker_id, 'spot_offer', 'Offre expiree',
      'Le delai de confirmation est depasse. La place est proposee au candidat suivant.',
      jsonb_build_object('offer_id', r.id, 'mission_id', r.mission_id)
    );
    perform private.offer_spot_to_next(r.mission_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.expire_overdue_spot_offers()
  from public, anon, authenticated;
grant execute on function public.expire_overdue_spot_offers() to service_role;

comment on function public.expire_overdue_spot_offers() is
  'Expire les offres de place non confirmees (2 min) et fait avancer la file. '
  'Appelee par la tache planifiee supabase/functions/process-spot-offers '
  '(service_role, cadence 1 minute). Ne jamais remplacer par pg_sleep.';

-- ---------------------------------------------------------------------------
-- Garde de candidatures : ajout du plafond de file d'attente (places + 3).
-- Corps identique a 20260715150000, plus le bloc INSERT sur v_waiting.
-- ---------------------------------------------------------------------------
create or replace function public.guard_application_state_and_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_backend boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_mission record;
  v_capacity integer;
  v_committed integer;
  v_active integer;
begin
  if tg_op = 'INSERT' then
    if not v_backend and new.status <> 'pending' then
      raise exception using errcode = '23514', message = 'Une candidature commence au statut en attente.';
    end if;

    -- Liste d'attente : au plus (places + 3) candidatures actives par
    -- mission. Le verrou sur la mission serialise les candidatures
    -- concurrentes, comme pour la capacite d'acceptation.
    if not v_backend then
      select m.positions, m.places
      into v_mission
      from public.missions m
      where m.id = new.mission_id
      for update;
      if found then
        v_capacity := coalesce(nullif(v_mission.positions, 0), nullif(v_mission.places, 0), 1);
        select count(*) into v_active
        from public.applications a
        where a.mission_id = new.mission_id
          and a.id is distinct from new.id
          and a.status in ('pending', 'accepted', 'in_progress', 'payment_pending', 'disputed');
        if v_active >= v_capacity + 3 then
          raise exception using errcode = '23514', message = 'La liste d attente de cette mission est complete.';
        end if;
      end if;
    end if;
  elsif new.status is distinct from old.status and not v_backend then
    if not (
      (old.status = 'pending' and new.status in ('accepted', 'rejected', 'cancelled'))
      or (old.status = 'accepted' and new.status in ('in_progress', 'cancelled', 'disputed'))
      or (old.status = 'in_progress' and new.status in ('payment_pending', 'cancelled', 'disputed'))
      or (old.status = 'payment_pending' and new.status = 'disputed')
    ) then
      raise exception using errcode = '23514', message = 'Transition de candidature interdite.';
    end if;

    if new.status = 'in_progress'
       and (new.actual_start_at is null or new.attendance_status <> 'start_confirmed') then
      raise exception using errcode = '23514', message = 'Le debut doit etre confirme par le pointage securise.';
    end if;
    if new.status = 'payment_pending'
       and (new.actual_end_at is null or new.payment_ready_at is null
            or new.attendance_status <> 'end_confirmed') then
      raise exception using errcode = '23514', message = 'La fin doit etre confirmee avant paiement.';
    end if;
  end if;

  if new.status = 'accepted'
     and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    select m.status, m.positions, m.places
    into v_mission
    from public.missions m
    where m.id = new.mission_id
    for update;

    if not found or v_mission.status <> 'open' then
      raise exception using errcode = '23514', message = 'Cette mission n accepte plus de candidature.';
    end if;

    v_capacity := coalesce(nullif(v_mission.positions, 0), nullif(v_mission.places, 0), 1);
    select count(*) into v_committed
    from public.applications a
    where a.mission_id = new.mission_id
      and a.id is distinct from new.id
      and a.status in ('accepted', 'in_progress', 'payment_pending', 'completed', 'disputed');

    if v_committed >= v_capacity then
      raise exception using errcode = '23514', message = 'Toutes les places de cette mission sont deja pourvues.';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_application_state_and_capacity()
  from public, anon, authenticated;
