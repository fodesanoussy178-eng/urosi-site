-- Document 6 (a) — journal d'audit centralisé des événements critiques.
--
-- Adapté à l'architecture UROSI : le journal MANUEL du fondateur existe déjà
-- (public.founder_admin_log, lu par founder_admin_audit_log). Ce qui manquait,
-- c'est l'enregistrement AUTOMATIQUE des événements critiques de la plateforme.
--
-- Choix d'implémentation :
--  * table en schéma `private` : jamais exposée à l'API, aucune policy client
--    nécessaire — lecture uniquement via une RPC fondateur SECURITY DEFINER ;
--  * alimentation par TRIGGERS aux points de vérité déjà existants (aucune
--    réécriture des RPC Stripe / pointage : on observe les changements d'état),
--    donc aucune duplication de logique métier ;
--  * une seule RPC de lecture qui UNIT le journal automatique et le journal
--    manuel fondateur → un journal réellement centralisé, sans recopier de
--    données.

create table if not exists private.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_type text not null,
  actor_role text not null,          -- worker | structure | founder | system
  actor_id uuid,                     -- qui a agi (null = système/webhook)
  subject_user_id uuid,              -- utilisateur concerné
  mission_id uuid,
  application_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'
);

create index if not exists platform_audit_created_idx on private.platform_audit_log (created_at desc);
create index if not exists platform_audit_type_idx on private.platform_audit_log (event_type);
create index if not exists platform_audit_mission_idx on private.platform_audit_log (mission_id) where mission_id is not null;
create index if not exists platform_audit_subject_idx on private.platform_audit_log (subject_user_id) where subject_user_id is not null;

-- Rôle de l'acteur courant vis-à-vis d'un travailleur donné.
create or replace function private.audit_actor_role(p_worker uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when auth.uid() is null then 'system'
    when public.is_founder() then 'founder'
    when auth.uid() = p_worker then 'worker'
    else 'structure'
  end;
$$;

create or replace function private.log_platform_event(
  p_event_type text, p_actor_role text, p_actor_id uuid, p_subject_user_id uuid,
  p_mission_id uuid, p_application_id uuid, p_summary text, p_metadata jsonb default '{}'
)
returns void
language sql security definer set search_path = ''
as $$
  insert into private.platform_audit_log (
    event_type, actor_role, actor_id, subject_user_id, mission_id, application_id, summary, metadata
  ) values (
    p_event_type, p_actor_role, p_actor_id, p_subject_user_id, p_mission_id, p_application_id, p_summary,
    coalesce(p_metadata, '{}'::jsonb)
  );
$$;

-- Paiement / remboursement / remplacement / annulation, observés sur la
-- candidature (aucune RPC réécrite).
create or replace function private.trg_audit_application()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_title text;
  v_role text;
begin
  select m.title into v_title from public.missions m where m.id = new.mission_id;
  v_role := private.audit_actor_role(new.worker_id);

  if new.stripe_payment_status = 'paid' and old.stripe_payment_status is distinct from 'paid' then
    perform private.log_platform_event('stripe_payment', v_role, auth.uid(), new.worker_id, new.mission_id, new.id,
      'Paiement Stripe confirmé pour « ' || coalesce(v_title, '?') || ' »',
      jsonb_build_object('payment_intent', new.stripe_payment_intent_id));
  elsif new.stripe_payment_status = 'refunded' and old.stripe_payment_status is distinct from 'refunded' then
    perform private.log_platform_event('refund', v_role, auth.uid(), new.worker_id, new.mission_id, new.id,
      'Remboursement Stripe de « ' || coalesce(v_title, '?') || ' »', '{}'::jsonb);
  elsif new.stripe_payment_status = 'transferred' and old.stripe_payment_status is distinct from 'transferred' then
    perform private.log_platform_event('worker_replaced', v_role, auth.uid(), new.worker_id, new.mission_id, new.id,
      'Travailleur remplacé sur « ' || coalesce(v_title, '?') || ' » (paiement transféré)', '{}'::jsonb);
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and coalesce(new.stripe_payment_status, '') <> 'transferred' then
    perform private.log_platform_event('mission_cancelled', v_role, auth.uid(), new.worker_id, new.mission_id, new.id,
      'Candidature annulée sur « ' || coalesce(v_title, '?') || ' »', '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists applications_audit on public.applications;
create trigger applications_audit
  after update of status, stripe_payment_status on public.applications
  for each row execute function private.trg_audit_application();

-- Tout mouvement Wallet (gain, charge, commission, contre-passation…).
create or replace function private.trg_audit_wallet()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_mission uuid;
begin
  select w.profile_id into v_owner from public.wallets w where w.id = new.wallet_id;
  select a.mission_id into v_mission from public.applications a where a.id = new.application_id;
  perform private.log_platform_event(
    'wallet_move',
    case when auth.uid() is null then 'system' else private.audit_actor_role(v_owner) end,
    auth.uid(), v_owner, v_mission, new.application_id,
    'Mouvement Wallet ' || new.kind || ' : '
      || to_char(new.amount_cents / 100.0, 'FM999990.00') || ' € (' || new.fund_status || ')',
    jsonb_build_object('kind', new.kind, 'amount_cents', new.amount_cents, 'fund_status', new.fund_status)
  );
  return new;
end;
$$;

drop trigger if exists wallet_transactions_audit on public.wallet_transactions;
create trigger wallet_transactions_audit
  after insert on public.wallet_transactions
  for each row execute function private.trg_audit_wallet();

-- Validations QR d'arrivée / de départ.
create or replace function private.trg_audit_attendance()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_title text;
begin
  if new.event_type not in ('start_confirmed', 'end_confirmed') then
    return new;
  end if;
  select m.title into v_title from public.missions m where m.id = new.mission_id;
  perform private.log_platform_event(
    case when new.event_type = 'start_confirmed' then 'qr_start' else 'qr_end' end,
    private.audit_actor_role(new.worker_id),
    coalesce(new.validated_by, auth.uid()), new.worker_id, new.mission_id, new.application_id,
    case when new.event_type = 'start_confirmed' then 'Pointage d''arrivée validé'
         else 'Pointage de départ validé' end || ' sur « ' || coalesce(v_title, '?') || ' »',
    jsonb_build_object('method', new.method)
  );
  return new;
end;
$$;

drop trigger if exists attendance_events_audit on public.attendance_events;
create trigger attendance_events_audit
  after insert on public.attendance_events
  for each row execute function private.trg_audit_attendance();

-- Lecture fondateur : journal centralisé (événements automatiques + actions
-- manuelles du fondateur), avec filtres (type, rôle acteur, utilisateur,
-- mission, période), recherche plein texte et pagination.
create or replace function public.founder_platform_audit(
  p_event_type text default null,
  p_actor_role text default null,
  p_user_id uuid default null,
  p_mission_id uuid default null,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_founder();
  return coalesce((
    select jsonb_agg(to_jsonb(x)) from (
      select u.id, u.created_at, u.event_type, u.actor_role, u.actor_id, u.subject_user_id, u.mission_id, u.summary,
             pa.full_name as actor_name, ps.full_name as subject_name, m.title as mission_title
      from (
        select a.id::text as id, a.created_at, a.event_type, a.actor_role, a.actor_id,
               a.subject_user_id, a.mission_id, a.summary
        from private.platform_audit_log a
        union all
        select l.id::text, l.created_at, l.action, 'founder', l.actor_id, null::uuid,
               case when l.target_type = 'mission' then l.target_id else null end,
               coalesce(l.target_label, l.action)
        from public.founder_admin_log l
      ) u
      left join public.profiles pa on pa.id = u.actor_id
      left join public.profiles ps on ps.id = u.subject_user_id
      left join public.missions m on m.id = u.mission_id
      where (p_event_type is null or u.event_type = p_event_type)
        and (p_actor_role is null or u.actor_role = p_actor_role)
        and (p_user_id is null or u.actor_id = p_user_id or u.subject_user_id = p_user_id)
        and (p_mission_id is null or u.mission_id = p_mission_id)
        and (p_from is null or u.created_at >= p_from)
        and (p_to is null or u.created_at <= p_to)
        and (
          p_search is null
          or u.summary ilike '%' || p_search || '%'
          or coalesce(m.title, '') ilike '%' || p_search || '%'
          or coalesce(pa.full_name, '') ilike '%' || p_search || '%'
          or coalesce(ps.full_name, '') ilike '%' || p_search || '%'
        )
      order by u.created_at desc
      limit greatest(1, least(coalesce(p_limit, 50), 200))
      offset greatest(0, coalesce(p_offset, 0))
    ) x
  ), '[]'::jsonb);
end;
$$;
