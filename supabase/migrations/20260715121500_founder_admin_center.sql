-- Centre d'administration Fondateur UROSI.
--
-- Cette migration conserve le KYC existant et ajoute un back-office unique,
-- audite et pilote exclusivement par des RPC SECURITY DEFINER. Le laboratoire
-- reste physiquement separe des donnees metier et ne peut etre active que sur
-- une base explicitement marquee staging.

create schema if not exists private;

create table if not exists private.founder_settings (
  singleton boolean primary key default true check (singleton),
  environment text not null default 'production' check (environment in ('production', 'staging')),
  lab_enabled boolean not null default false,
  require_mfa boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into private.founder_settings (singleton)
values (true)
on conflict (singleton) do nothing;

revoke all on table private.founder_settings from public, anon, authenticated;

alter table public.profiles add column if not exists account_status text not null default 'active';
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles
  add constraint profiles_account_status_check check (account_status in ('active', 'suspended'));
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists suspended_until timestamptz;
alter table public.profiles add column if not exists suspension_reason text;
alter table public.profiles add column if not exists suspended_by uuid references public.profiles (id) on delete set null;

create index if not exists profiles_account_status_idx
  on public.profiles (account_status, created_at desc);
create index if not exists profiles_suspended_by_idx
  on public.profiles (suspended_by) where suspended_by is not null;

create table if not exists public.founder_admin_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  action text not null,
  target_type text not null,
  target_id uuid,
  target_label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists founder_admin_log_created_idx
  on public.founder_admin_log (created_at desc);
create index if not exists founder_admin_log_target_idx
  on public.founder_admin_log (target_type, target_id, created_at desc);
create index if not exists founder_admin_log_actor_idx
  on public.founder_admin_log (actor_id, created_at desc);

alter table public.founder_admin_log enable row level security;
drop policy if exists "founder admin log: founder read" on public.founder_admin_log;
create policy "founder admin log: founder read"
  on public.founder_admin_log for select to authenticated
  using ((select public.is_founder()));

revoke all on table public.founder_admin_log from public, anon, authenticated;
grant select on table public.founder_admin_log to authenticated;

create table if not exists public.mission_report_actions (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.mission_reports (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  action text not null check (action in ('classified', 'information_requested', 'warned', 'suspended', 'reactivated')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists mission_report_actions_report_idx
  on public.mission_report_actions (report_id, created_at desc);
create index if not exists mission_report_actions_actor_idx
  on public.mission_report_actions (actor_id, created_at desc);
create index if not exists mission_reports_founder_queue_idx
  on public.mission_reports (status, created_at desc);

alter table public.mission_report_actions enable row level security;
drop policy if exists "mission report actions: founder read" on public.mission_report_actions;
create policy "mission report actions: founder read"
  on public.mission_report_actions for select to authenticated
  using ((select public.is_founder()));

revoke all on table public.mission_report_actions from public, anon, authenticated;
grant select on table public.mission_report_actions to authenticated;

create table if not exists public.founder_lab_scenarios (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('user', 'structure', 'mission', 'pricing', 'payment', 'kyc')),
  label text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists founder_lab_scenarios_created_idx
  on public.founder_lab_scenarios (created_at desc);
create index if not exists founder_lab_scenarios_creator_idx
  on public.founder_lab_scenarios (created_by, created_at desc);

alter table public.founder_lab_scenarios enable row level security;
drop policy if exists "founder lab: founder read" on public.founder_lab_scenarios;
create policy "founder lab: founder read"
  on public.founder_lab_scenarios for select to authenticated
  using ((select public.is_founder()));

revoke all on table public.founder_lab_scenarios from public, anon, authenticated;

create or replace function private.assert_founder()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_require_mfa boolean;
begin
  if not public.is_founder() then
    raise exception using errcode = '42501', message = 'Acces fondateur requis.';
  end if;

  select require_mfa into v_require_mfa
  from private.founder_settings
  where singleton;

  if coalesce(v_require_mfa, false)
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception using errcode = '42501', message = 'Authentification a deux facteurs requise.';
  end if;
end;
$$;

revoke execute on function private.assert_founder() from public, anon, authenticated;

create or replace function private.log_founder_action(
  p_action text,
  p_target_type text,
  p_target_id uuid default null,
  p_target_label text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.founder_admin_log (
    actor_id, action, target_type, target_id, target_label, metadata
  ) values (
    auth.uid(), p_action, p_target_type, p_target_id, p_target_label,
    coalesce(p_metadata, '{}'::jsonb)
  )
$$;

revoke execute on function private.log_founder_action(text, text, uuid, text, jsonb)
  from public, anon, authenticated;

create or replace function private.guard_active_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_until timestamptz;
begin
  if v_uid is null or public.is_founder() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select account_status, suspended_until into v_status, v_until
  from public.profiles
  where id = v_uid;

  if v_status = 'suspended' and (v_until is null or v_until > now()) then
    raise exception using errcode = '42501', message = 'Compte temporairement suspendu.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function private.guard_active_account() from public, anon, authenticated;

drop trigger if exists structures_guard_active_account on public.structures;
create trigger structures_guard_active_account
  before insert or update or delete on public.structures
  for each row execute function private.guard_active_account();
drop trigger if exists missions_guard_active_account on public.missions;
create trigger missions_guard_active_account
  before insert or update or delete on public.missions
  for each row execute function private.guard_active_account();
drop trigger if exists applications_guard_active_account on public.applications;
create trigger applications_guard_active_account
  before insert or update or delete on public.applications
  for each row execute function private.guard_active_account();
drop trigger if exists mission_reports_guard_active_account on public.mission_reports;
create trigger mission_reports_guard_active_account
  before insert or update or delete on public.mission_reports
  for each row execute function private.guard_active_account();
drop trigger if exists ratings_guard_active_account on public.ratings;
create trigger ratings_guard_active_account
  before insert or update or delete on public.ratings
  for each row execute function private.guard_active_account();

create or replace function public.founder_admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_require_mfa boolean;
begin
  perform private.assert_founder();
  select require_mfa into v_require_mfa from private.founder_settings where singleton;

  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'structures', (select count(*) from public.structures),
    'missions_published', (select count(*) from public.missions),
    'missions_in_progress', (select count(distinct mission_id) from public.applications where status = 'in_progress'),
    'missions_completed', (select count(*) from public.missions where status = 'closed'),
    'applications', (select count(*) from public.applications),
    'reports_pending', (select count(*) from public.mission_reports where status in ('open', 'awaiting_response', 'reviewing')),
    'kyc_pending', (select count(*) from public.profiles where kyc_status in ('requested', 'submitted')),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'mfa_required', coalesce(v_require_mfa, false)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.founder_admin_accounts(p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := '%' || lower(btrim(coalesce(p_search, ''))) || '%';
  v_profiles jsonb;
  v_structures jsonb;
begin
  perform private.assert_founder();

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_profiles
  from (
    select p.id, p.full_name, u.email, p.role, p.account_status,
           p.suspended_until, p.suspension_reason, p.kyc_status, p.created_at,
           (select count(*) from public.applications a where a.worker_id = p.id) as history_count
    from public.profiles p
    join auth.users u on u.id = p.id
    where v_query = '%%'
       or lower(p.full_name) like v_query
       or lower(coalesce(u.email, '')) like v_query
    limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_structures
  from (
    select s.id, s.owner_id, s.name, u.email, p.account_status,
           s.verification_status, s.created_at,
           (select count(*) from public.missions m where m.structure_id = s.id) as history_count
    from public.structures s
    join public.profiles p on p.id = s.owner_id
    join auth.users u on u.id = s.owner_id
    where v_query = '%%'
       or lower(s.name) like v_query
       or lower(coalesce(u.email, '')) like v_query
    limit 100
  ) x;

  return jsonb_build_object('profiles', v_profiles, 'structures', v_structures);
end;
$$;

create or replace function public.founder_admin_account_history(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_founder();
  return jsonb_build_object(
    'worker_missions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select m.id, m.title, s.name as structure_name, m.scheduled_date,
               m.status as mission_status, a.status as application_status, a.created_at
        from public.applications a
        join public.missions m on m.id = a.mission_id
        join public.structures s on s.id = m.structure_id
        where a.worker_id = p_profile_id
        limit 50
      ) x
    ), '[]'::jsonb),
    'structure_missions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select m.id, m.title, s.name as structure_name, m.scheduled_date,
               m.status, m.created_at
        from public.missions m
        join public.structures s on s.id = m.structure_id
        where s.owner_id = p_profile_id
        limit 50
      ) x
    ), '[]'::jsonb),
    'admin_actions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select action, target_type, target_label, metadata, created_at
        from public.founder_admin_log
        where target_id = p_profile_id
        limit 50
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.founder_admin_set_account_status(
  p_profile_id uuid,
  p_status text,
  p_reason text default null,
  p_suspended_until timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.assert_founder();
  if p_status not in ('active', 'suspended') then
    raise exception using errcode = '22023', message = 'Statut de compte invalide.';
  end if;
  if p_profile_id = auth.uid() then
    raise exception using errcode = '22023', message = 'Impossible de suspendre son propre compte fondateur.';
  end if;
  if exists (select 1 from public.founder_access where user_id = p_profile_id) then
    raise exception using errcode = '22023', message = 'Un compte fondateur ne peut pas etre suspendu ici.';
  end if;
  if p_status = 'suspended' and v_reason is null then
    raise exception using errcode = '22023', message = 'Un motif de suspension est requis.';
  end if;

  update public.profiles
  set account_status = p_status,
      suspended_at = case when p_status = 'suspended' then now() else null end,
      suspended_until = case when p_status = 'suspended' then p_suspended_until else null end,
      suspension_reason = case when p_status = 'suspended' then v_reason else null end,
      suspended_by = case when p_status = 'suspended' then auth.uid() else null end
  where id = p_profile_id
  returning full_name into v_name;

  if not found then
    raise exception using errcode = 'P0002', message = 'Compte introuvable.';
  end if;

  perform private.log_founder_action(
    case when p_status = 'suspended' then 'account_suspended' else 'account_reactivated' end,
    'profile', p_profile_id, v_name,
    jsonb_build_object('reason', v_reason, 'suspended_until', p_suspended_until)
  );
end;
$$;

create or replace function public.founder_admin_missions(
  p_search text default null,
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := '%' || lower(btrim(coalesce(p_search, ''))) || '%';
begin
  perform private.assert_founder();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.scheduled_date desc, x.created_at desc)
    from (
      select m.id, m.title, m.status, s.name as structure_name, m.scheduled_date,
             m.mission_category as category, m.structure_total as amount,
             count(a.id) as participants, m.created_at
      from public.missions m
      join public.structures s on s.id = m.structure_id
      left join public.applications a on a.mission_id = m.id
        and a.status in ('accepted', 'in_progress', 'payment_pending', 'completed')
      where (v_query = '%%' or lower(m.title) like v_query or lower(s.name) like v_query)
        and (p_status is null or p_status = '' or m.status = p_status)
      group by m.id, s.name
      limit 150
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.founder_admin_set_mission_status(
  p_mission_id uuid,
  p_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.assert_founder();
  if p_status not in ('open', 'closed', 'cancelled') or v_reason is null then
    raise exception using errcode = '22023', message = 'Statut ou motif invalide.';
  end if;
  update public.missions set status = p_status where id = p_mission_id returning title into v_title;
  if not found then raise exception using errcode = 'P0002', message = 'Mission introuvable.'; end if;
  perform private.log_founder_action(
    'mission_status_changed', 'mission', p_mission_id, v_title,
    jsonb_build_object('status', p_status, 'reason', v_reason)
  );
end;
$$;

create or replace function public.founder_admin_reports(p_status text default null)
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
      select r.id, r.category, r.description, r.severity, r.status, r.created_at,
             r.reported_user_id, r.structure_id, m.title as mission_title,
             reporter.full_name as reporter_name,
             coalesce(target.full_name, s.name) as target_name,
             coalesce((
               select jsonb_agg(to_jsonb(a) order by a.created_at desc)
               from public.mission_report_actions a where a.report_id = r.id
             ), '[]'::jsonb) as history
      from public.mission_reports r
      join public.missions m on m.id = r.mission_id
      join public.structures s on s.id = r.structure_id
      join public.profiles reporter on reporter.id = r.reporter_id
      left join public.profiles target on target.id = r.reported_user_id
      where p_status is null or p_status = '' or r.status = p_status
      limit 150
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.founder_admin_act_on_report(
  p_report_id uuid,
  p_action text,
  p_note text default null,
  p_suspended_until timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.mission_reports%rowtype;
  v_target uuid;
  v_target_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_history_action text;
begin
  perform private.assert_founder();
  if p_action not in ('classify', 'request_information', 'warn', 'suspend', 'reactivate') then
    raise exception using errcode = '22023', message = 'Action de signalement invalide.';
  end if;
  if p_action in ('request_information', 'warn', 'suspend') and v_note is null then
    raise exception using errcode = '22023', message = 'Une note est requise pour cette action.';
  end if;

  select * into v_report from public.mission_reports where id = p_report_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Signalement introuvable.'; end if;

  v_target := v_report.reported_user_id;
  if v_target is null then
    select owner_id into v_target from public.structures where id = v_report.structure_id;
  end if;
  select full_name into v_target_name from public.profiles where id = v_target;

  update public.mission_reports
  set status = case p_action
        when 'classify' then 'resolved'
        when 'request_information' then 'awaiting_response'
        else 'reviewing'
      end,
      responded_at = case when p_action = 'request_information' then now() else responded_at end,
      resolved_at = case when p_action = 'classify' then now() else null end,
      resolved_by = case when p_action = 'classify' then auth.uid() else null end
  where id = p_report_id;

  if p_action = 'suspend' then
    perform public.founder_admin_set_account_status(v_target, 'suspended', v_note, p_suspended_until);
  elsif p_action = 'reactivate' then
    perform public.founder_admin_set_account_status(v_target, 'active', null, null);
  end if;

  v_history_action := case p_action
    when 'classify' then 'classified'
    when 'request_information' then 'information_requested'
    when 'warn' then 'warned'
    when 'suspend' then 'suspended'
    else 'reactivated'
  end;

  insert into public.mission_report_actions (report_id, actor_id, action, note)
  values (p_report_id, auth.uid(), v_history_action, v_note);

  perform private.log_founder_action(
    'report_' || p_action, 'report', p_report_id, v_target_name,
    jsonb_build_object('note', v_note, 'target_profile_id', v_target, 'suspended_until', p_suspended_until)
  );
end;
$$;

create or replace function public.founder_admin_revenue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_founder();
  return jsonb_build_object(
    'generated_cents', coalesce((select sum(amount_cents) from public.platform_revenue), 0),
    'pending_cents', coalesce((select sum(amount_cents) from public.platform_revenue where reconciled_at is null), 0),
    'month_cents', coalesce((select sum(amount_cents) from public.platform_revenue where created_at >= date_trunc('month', now())), 0),
    'lifetime_cents', coalesce((select sum(amount_cents) from public.platform_revenue), 0),
    'simulated_cents', coalesce((select sum(amount_cents) from public.platform_revenue where provider_status = 'simulated'), 0),
    'confirmed_cents', coalesce((select sum(amount_cents) from public.platform_revenue where provider_status = 'confirmed' and reconciled_at is not null), 0),
    'simulated', exists (select 1 from public.platform_revenue where provider_status = 'simulated')
  );
end;
$$;

create or replace function public.founder_admin_audit_log(p_limit integer default 100)
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
      select l.id, l.action, l.target_type, l.target_id, l.target_label,
             l.metadata, l.created_at, p.full_name as actor_name
      from public.founder_admin_log l
      join public.profiles p on p.id = l.actor_id
      order by l.created_at desc
      limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.founder_set_kyc_status(
  p_profile_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_name text;
begin
  perform private.assert_founder();
  if p_status not in ('verified', 'rejected') then
    raise exception using errcode = '22023', message = 'Decision KYC invalide.';
  end if;
  if p_status = 'rejected' and v_reason is null then
    raise exception using errcode = '22023', message = 'Un motif est requis pour refuser.';
  end if;

  perform set_config('app.kyc_source', 'founder_review', true);
  perform set_config('app.kyc_reason', coalesce(v_reason, ''), true);
  update public.profiles
  set kyc_status = p_status
  where id = p_profile_id and role = 'worker' and kyc_status = 'submitted'
  returning full_name into v_name;
  if not found then
    raise exception using errcode = '23514', message = 'Ce dossier KYC ne peut pas etre traite.';
  end if;
  perform private.log_founder_action(
    'kyc_' || p_status, 'profile', p_profile_id, v_name,
    jsonb_build_object('reason', v_reason)
  );
end;
$$;

create or replace function public.founder_admin_request_kyc_document(
  p_profile_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_name text;
begin
  perform private.assert_founder();
  if v_reason is null then
    raise exception using errcode = '22023', message = 'Precisez le document attendu.';
  end if;
  perform set_config('app.kyc_source', 'founder_review', true);
  perform set_config('app.kyc_reason', v_reason, true);
  update public.profiles
  set kyc_status = 'requested', kyc_requested_at = now(), kyc_submitted_at = null
  where id = p_profile_id and role = 'worker' and kyc_status in ('submitted', 'rejected')
  returning full_name into v_name;
  if not found then
    raise exception using errcode = '23514', message = 'Un nouveau document ne peut pas etre demande pour ce dossier.';
  end if;
  perform private.log_founder_action(
    'kyc_document_requested', 'profile', p_profile_id, v_name,
    jsonb_build_object('reason', v_reason)
  );
end;
$$;

create or replace function public.founder_admin_lab_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_environment text;
  v_enabled boolean;
begin
  perform private.assert_founder();
  select environment, lab_enabled into v_environment, v_enabled
  from private.founder_settings where singleton;
  return jsonb_build_object(
    'environment', coalesce(v_environment, 'production'),
    'enabled', coalesce(v_enabled, false) and v_environment = 'staging',
    'scenarios', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select id, entity_type, label, payload, created_at
        from public.founder_lab_scenarios
        limit 50
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.founder_admin_lab_create(p_entity_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_environment text;
  v_enabled boolean;
  v_row public.founder_lab_scenarios%rowtype;
begin
  perform private.assert_founder();
  select environment, lab_enabled into v_environment, v_enabled
  from private.founder_settings where singleton;
  if v_environment <> 'staging' or not coalesce(v_enabled, false) then
    raise exception using errcode = '42501', message = 'Laboratoire bloque : utilisez une base Supabase staging separee.';
  end if;
  if p_entity_type not in ('user', 'structure', 'mission', 'pricing', 'payment', 'kyc') then
    raise exception using errcode = '22023', message = 'Scenario de laboratoire invalide.';
  end if;

  insert into public.founder_lab_scenarios (entity_type, label, payload, created_by)
  values (
    p_entity_type,
    'Simulation ' || p_entity_type || ' ' || to_char(now(), 'DD/MM HH24:MI'),
    jsonb_build_object('simulated', true, 'seed', floor(random() * 1000000)::integer),
    auth.uid()
  ) returning * into v_row;

  perform private.log_founder_action(
    'lab_scenario_created', 'lab_scenario', v_row.id, v_row.label,
    jsonb_build_object('entity_type', p_entity_type, 'environment', v_environment)
  );
  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.founder_admin_dashboard() from public, anon;
revoke execute on function public.founder_admin_accounts(text) from public, anon;
revoke execute on function public.founder_admin_account_history(uuid) from public, anon;
revoke execute on function public.founder_admin_set_account_status(uuid, text, text, timestamptz) from public, anon;
revoke execute on function public.founder_admin_missions(text, text) from public, anon;
revoke execute on function public.founder_admin_set_mission_status(uuid, text, text) from public, anon;
revoke execute on function public.founder_admin_reports(text) from public, anon;
revoke execute on function public.founder_admin_act_on_report(uuid, text, text, timestamptz) from public, anon;
revoke execute on function public.founder_admin_revenue() from public, anon;
revoke execute on function public.founder_admin_audit_log(integer) from public, anon;
revoke execute on function public.founder_admin_request_kyc_document(uuid, text) from public, anon;
revoke execute on function public.founder_admin_lab_status() from public, anon;
revoke execute on function public.founder_admin_lab_create(text) from public, anon;
revoke execute on function public.founder_set_kyc_status(uuid, text, text) from public, anon;

grant execute on function public.founder_admin_dashboard() to authenticated;
grant execute on function public.founder_admin_accounts(text) to authenticated;
grant execute on function public.founder_admin_account_history(uuid) to authenticated;
grant execute on function public.founder_admin_set_account_status(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.founder_admin_missions(text, text) to authenticated;
grant execute on function public.founder_admin_set_mission_status(uuid, text, text) to authenticated;
grant execute on function public.founder_admin_reports(text) to authenticated;
grant execute on function public.founder_admin_act_on_report(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.founder_admin_revenue() to authenticated;
grant execute on function public.founder_admin_audit_log(integer) to authenticated;
grant execute on function public.founder_admin_request_kyc_document(uuid, text) to authenticated;
grant execute on function public.founder_admin_lab_status() to authenticated;
grant execute on function public.founder_admin_lab_create(text) to authenticated;
grant execute on function public.founder_set_kyc_status(uuid, text, text) to authenticated;

comment on table public.founder_admin_log is
  'Journal immuable des actions sensibles realisees depuis le centre Fondateur.';
comment on table public.founder_lab_scenarios is
  'Scenarios de test isoles des tables metier et utilisables uniquement en staging.';
