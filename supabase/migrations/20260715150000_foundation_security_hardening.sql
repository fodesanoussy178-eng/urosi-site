-- UROSI foundations: wallet isolation, production payment safety, KYC audit,
-- mission lifecycle and capacity enforcement.

-- ---------------------------------------------------------------------------
-- Wallets: a browser session must never create money or request a withdrawal.
-- ---------------------------------------------------------------------------
revoke execute on function public.deposit_wallet(bigint, text)
  from public, anon, authenticated;
revoke execute on function public.withdraw_wallet(bigint)
  from public, anon, authenticated;

alter table public.wallet_transactions
  add column if not exists fund_status text not null default 'available';

alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_fund_status_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_fund_status_check
  check (fund_status in ('pending', 'available', 'blocked'));

create index if not exists wallet_transactions_wallet_status_created_idx
  on public.wallet_transactions (wallet_id, fund_status, created_at desc);

create or replace function public.wallet_apply_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.fund_status = 'available' then
      update public.wallets
      set balance_cents = balance_cents + new.amount_cents
      where id = new.wallet_id;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.wallet_id <> new.wallet_id then
      raise exception using errcode = '23514', message = 'Le wallet d un mouvement est immuable.';
    end if;
    update public.wallets
    set balance_cents = balance_cents
      - case when old.fund_status = 'available' then old.amount_cents else 0 end
      + case when new.fund_status = 'available' then new.amount_cents else 0 end
    where id = new.wallet_id;
    return new;
  end if;

  if old.fund_status = 'available' then
    update public.wallets
    set balance_cents = balance_cents - old.amount_cents
    where id = old.wallet_id;
  end if;
  return old;
end;
$$;

revoke execute on function public.wallet_apply_transaction()
  from public, anon, authenticated;

drop trigger if exists wallet_transactions_apply on public.wallet_transactions;
create trigger wallet_transactions_apply
  after insert or update of amount_cents, fund_status or delete
  on public.wallet_transactions
  for each row execute function public.wallet_apply_transaction();

update public.wallets w
set balance_cents = coalesce((
  select sum(t.amount_cents)
  from public.wallet_transactions t
  where t.wallet_id = w.id and t.fund_status = 'available'
), 0);

-- The legacy internal provider is allowed only in the isolated staging lab.
create or replace function private.guard_simulated_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean := false;
begin
  select environment = 'staging' and lab_enabled
  into v_allowed
  from private.founder_settings
  where singleton;

  if coalesce(new.provider, 'internal') = 'internal'
     and not coalesce(v_allowed, false) then
    raise exception using
      errcode = '42501',
      message = 'Paiement simule desactive hors du laboratoire staging.';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_simulated_payment()
  from public, anon, authenticated;

drop trigger if exists payments_block_simulation_outside_staging on public.payments;
create trigger payments_block_simulation_outside_staging
  before insert or update of provider on public.payments
  for each row execute function private.guard_simulated_payment();

-- ---------------------------------------------------------------------------
-- Mission lifecycle: terminal missions are immutable and accepted capacity is
-- serialized with a row lock to avoid concurrent overbooking.
-- ---------------------------------------------------------------------------
create index if not exists applications_mission_status_idx
  on public.applications (mission_id, status);

create or replace function public.guard_mission_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_backend boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
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
      raise exception using
        errcode = '23514',
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
$$;

revoke execute on function public.guard_mission_lifecycle()
  from public, anon, authenticated;

drop trigger if exists missions_guard_lifecycle on public.missions;
create trigger missions_guard_lifecycle
  before update or delete on public.missions
  for each row execute function public.guard_mission_lifecycle();

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
begin
  if tg_op = 'INSERT' then
    if not v_backend and new.status <> 'pending' then
      raise exception using errcode = '23514', message = 'Une candidature commence au statut en attente.';
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

drop trigger if exists applications_guard_state_capacity on public.applications;
create trigger applications_guard_state_capacity
  before insert or update of status on public.applications
  for each row execute function public.guard_application_state_and_capacity();

-- ---------------------------------------------------------------------------
-- KYC: validate server-side storage metadata and log every founder access.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists identity_document_delete_after timestamptz;

create table if not exists public.kyc_document_access_log (
  id bigint generated by default as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  document_path text not null,
  accessed_by uuid not null references public.profiles (id) on delete restrict,
  purpose text not null default 'manual_review',
  created_at timestamptz not null default now(),
  constraint kyc_document_access_purpose_check
    check (purpose in ('manual_review', 'compliance_review', 'support_review'))
);

create index if not exists kyc_document_access_profile_created_idx
  on public.kyc_document_access_log (profile_id, created_at desc);

alter table public.kyc_document_access_log enable row level security;
revoke all on table public.kyc_document_access_log from public, anon, authenticated;

create or replace function public.log_kyc_document_access(
  p_profile_id uuid,
  p_document_path text,
  p_purpose text default 'manual_review'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_founder();
  if not exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.identity_document_path = p_document_path
  ) then
    raise exception using errcode = '22023', message = 'Document KYC introuvable pour ce profil.';
  end if;
  insert into public.kyc_document_access_log (
    profile_id, document_path, accessed_by, purpose
  ) values (
    p_profile_id, p_document_path, auth.uid(), p_purpose
  );
end;
$$;

revoke execute on function public.log_kyc_document_access(uuid, text, text)
  from public, anon;
grant execute on function public.log_kyc_document_access(uuid, text, text)
  to authenticated;

create or replace function public.validate_kyc_storage_object(
  p_profile_id uuid,
  p_document_path text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb;
  v_mime text;
  v_size bigint;
begin
  if p_document_path !~ ('^' || p_profile_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpg|jpeg|png|webp|pdf)$') then
    raise exception using errcode = '22023', message = 'Nom de fichier KYC non securise.';
  end if;

  select o.metadata into v_metadata
  from storage.objects o
  where o.bucket_id = 'kyc-documents' and o.name = p_document_path;
  if not found then
    raise exception using errcode = '22023', message = 'Document KYC introuvable.';
  end if;

  v_mime := lower(coalesce(v_metadata ->> 'mimetype', ''));
  if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception using errcode = '22023', message = 'Format de document KYC interdit.';
  end if;
  if coalesce(v_metadata ->> 'size', '') !~ '^[0-9]+$' then
    raise exception using errcode = '22023', message = 'Taille du document KYC introuvable.';
  end if;
  v_size := (v_metadata ->> 'size')::bigint;
  if v_size < 1 or v_size > 10485760 then
    raise exception using errcode = '22023', message = 'Document KYC trop volumineux.';
  end if;
end;
$$;

revoke execute on function public.validate_kyc_storage_object(uuid, text)
  from public, anon, authenticated;

-- Enforce the stronger validation without replacing the existing atomic KYC RPC.
create or replace function public.guard_kyc_submission_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kyc_status = 'submitted'
     and (old.kyc_status is distinct from 'submitted'
          or new.identity_document_path is distinct from old.identity_document_path) then
    perform public.validate_kyc_storage_object(new.id, new.identity_document_path);
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_kyc_submission_storage()
  from public, anon, authenticated;

drop trigger if exists profiles_validate_kyc_storage on public.profiles;
create trigger profiles_validate_kyc_storage
  before update of kyc_status, identity_document_path on public.profiles
  for each row execute function public.guard_kyc_submission_storage();
