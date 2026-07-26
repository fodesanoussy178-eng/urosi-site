-- MODULE 3 — deblocage des missions remunerees (travailleur).
--
-- Adapte du package de reference fourni (INTEGRATION.md) aux noms reels de
-- ce depot :
--   mission_applications -> public.applications
--   missions.remuneration -> missions.is_solidaire (deja la source de verite
--     existante, pas de comparaison a 0 sur un montant)
--   structures.type = 'association' -> structures.is_association (deja
--     derive automatiquement du registre officiel, jamais une saisie
--     manuelle — cf. 20260724230227_structure_association_classification)
--   profiles.stripe_account_id / stripe_payouts_enabled -> deja existants
--     (Module 1, Stripe Connect travailleur) : pas recrees ici.
--
-- Un travailleur peut deja participer aux missions solidaires des
-- l'inscription. Pour POSTULER a une mission remuneree, une activite
-- d'independant (SIRET verifie) ET un compte de versement actif
-- (stripe_payouts_enabled) sont requis — c'est le statut legal qui permet
-- de le payer, distinct du KYC identite deja en place.

-- ---------------------------------------------------------------------------
-- 1. Etat d'acces (derive, jamais ecrit a la main).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'worker_paid_status') then
    create type public.worker_paid_status as enum (
      'solidaire_only',      -- defaut : aucune donnee administrative
      'conversion_pending',  -- demarche entamee, non finalisee
      'paid_eligible'        -- SIRET verifie ET Stripe payouts_enabled
    );
  end if;
end
$$;

alter table public.profiles
  add column if not exists paid_status public.worker_paid_status not null default 'solidaire_only',
  add column if not exists siret text,
  add column if not exists siret_verified_at timestamptz,
  add column if not exists siret_last_checked_at timestamptz,
  add column if not exists siret_check_attempts integer not null default 0,
  add column if not exists stripe_requirements_pending boolean not null default false,
  add column if not exists conversion_started_at timestamptz,
  add column if not exists unlocked_at timestamptz,
  add column if not exists unlock_notified_at timestamptz;
-- stripe_account_id / stripe_payouts_enabled existent deja (Module 1).

alter table public.profiles drop constraint if exists profiles_siret_format_chk;
alter table public.profiles
  add constraint profiles_siret_format_chk
  check (siret is null or siret ~ '^[0-9]{14}$');

create unique index if not exists profiles_siret_unique_idx
  on public.profiles (siret) where siret is not null;

create index if not exists profiles_conversion_pending_idx
  on public.profiles (paid_status)
  where paid_status = 'conversion_pending';

-- ---------------------------------------------------------------------------
-- 2. Derivation automatique : jamais de UPDATE profiles SET paid_status = ...
--    ailleurs dans le code. Une regression Stripe (requirements a nouveau
--    dus) redescend l'etat seule, sans code de gestion dedie.
-- ---------------------------------------------------------------------------
create or replace function public.compute_worker_paid_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.siret_verified_at is not null and new.stripe_payouts_enabled then
    new.paid_status := 'paid_eligible';
    if tg_op = 'UPDATE' and old.paid_status is distinct from 'paid_eligible' then
      new.unlocked_at := now();
      new.unlock_notified_at := null; -- rearme la notification de deblocage
    end if;

  elsif new.siret is not null or new.stripe_account_id is not null then
    new.paid_status := 'conversion_pending';
    if new.conversion_started_at is null then
      new.conversion_started_at := now();
    end if;

  else
    new.paid_status := 'solidaire_only';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_compute_worker_paid_status on public.profiles;
create trigger trg_compute_worker_paid_status
  before insert or update of siret, siret_verified_at, stripe_account_id, stripe_payouts_enabled
  on public.profiles
  for each row
  execute function public.compute_worker_paid_status();

create or replace function public.current_worker_paid_status()
returns public.worker_paid_status
language sql
stable
security definer
set search_path = ''
as $$
  select paid_status from public.profiles where id = auth.uid();
$$;

revoke all on function public.current_worker_paid_status() from public;
grant execute on function public.current_worker_paid_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Verrou base sur la candidature : les missions remunerees restent
--    VISIBLES par tous (aucune policy de SELECT modifiee). Seul l'INSERT de
--    candidature est conditionne. Remplace "applications: worker apply"
--    (0004_fix_rls_recursion.sql) en y ajoutant la condition d'acces.
-- ---------------------------------------------------------------------------
drop policy if exists "applications: worker apply" on public.applications;
create policy "applications: worker apply"
  on public.applications for insert
  with check (
    worker_id = auth.uid()
    and public.mission_is_open(mission_id)
    and exists (
      select 1 from public.missions m
      where m.id = applications.mission_id
        and (m.is_solidaire or public.current_worker_paid_status() = 'paid_eligible')
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Garde-fou solidaire : une mission a 0 EUR ne peut venir que d'une
--    structure classee association (deja derivee du registre officiel,
--    jamais une saisie manuelle) — le benevolat en entreprise commerciale
--    n'existe pas. Attestation obligatoire : la mission solidaire ne
--    remplace pas un poste salarie.
-- ---------------------------------------------------------------------------
alter table public.missions add column if not exists no_salaried_substitution boolean not null default false;

create or replace function public.enforce_solidaire_association_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_association boolean;
begin
  if not new.is_solidaire then
    return new;
  end if;

  select s.is_association into v_is_association
  from public.structures s
  where s.id = new.structure_id;

  if not coalesce(v_is_association, false) then
    raise exception using errcode = '23514',
      message = 'Une mission solidaire ne peut être publiée que par une association.';
  end if;

  if not new.no_salaried_substitution then
    raise exception using errcode = '23514',
      message = 'Attestation manquante : la mission solidaire ne doit pas remplacer un poste salarié.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_solidaire_association_only on public.missions;
create trigger trg_solidaire_association_only
  before insert or update of is_solidaire, structure_id
  on public.missions
  for each row
  execute function public.enforce_solidaire_association_only();

-- ---------------------------------------------------------------------------
-- 5. Verification SIRET travailleur — appelee par l'edge function
--    verify-siret (jeton utilisateur, jamais service_role) : l'ecriture ne
--    porte jamais que sur le profil de l'appelant (auth.uid()).
--    Un SIRET absent de Sirene n'est pas une erreur (delai de propagation) :
--    p_status='pending' n'ecrit jamais siret_verified_at.
-- ---------------------------------------------------------------------------
create or replace function public.apply_worker_siret_verification(
  p_siret text,
  p_status text
) returns public.worker_paid_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.worker_paid_status;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Connexion requise.';
  end if;
  if p_status not in ('verified', 'pending', 'closed') then
    raise exception 'Statut de vérification SIRET invalide : %', p_status;
  end if;

  update public.profiles
  set siret = p_siret,
      siret_last_checked_at = now(),
      siret_verified_at = case when p_status = 'verified' then now() else null end
  where id = auth.uid();

  select paid_status into v_status from public.profiles where id = auth.uid();
  return v_status;
end;
$$;

revoke execute on function public.apply_worker_siret_verification(text, text) from public, anon;
grant execute on function public.apply_worker_siret_verification(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Cron quotidien recheck-siret (service_role uniquement) : revérifie les
--    SIRET pas encore actifs dans Sirene, et liste les profils venant d'être
--    débloqués pour notification (unlock_notified_at garantit un envoi
--    unique, y compris après une régression puis un nouveau déblocage).
-- ---------------------------------------------------------------------------
create or replace function public.workers_siret_pending_recheck(p_max_attempts integer default 30, p_limit integer default 200)
returns table (profile_id uuid, siret text, check_attempts integer)
language sql
stable
security definer
set search_path = ''
as $$
  select id, siret, siret_check_attempts
  from public.profiles
  where siret is not null
    and siret_verified_at is null
    and siret_check_attempts < coalesce(p_max_attempts, 30)
  limit greatest(1, least(coalesce(p_limit, 200), 500))
$$;

revoke execute on function public.workers_siret_pending_recheck(integer, integer) from public, anon, authenticated;
grant execute on function public.workers_siret_pending_recheck(integer, integer) to service_role;

create or replace function public.record_worker_siret_recheck(p_profile_id uuid, p_verified boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  if p_verified then
    update public.profiles
    set siret_verified_at = now(), siret_last_checked_at = now()
    where id = p_profile_id;
  else
    update public.profiles
    set siret_check_attempts = siret_check_attempts + 1,
        siret_last_checked_at = now()
    where id = p_profile_id;
  end if;
end;
$$;

revoke execute on function public.record_worker_siret_recheck(uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_worker_siret_recheck(uuid, boolean) to service_role;

create or replace function public.workers_pending_unlock_notification(p_limit integer default 200)
returns table (profile_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select id, full_name
  from public.profiles
  where paid_status = 'paid_eligible'
    and unlocked_at is not null
    and unlock_notified_at is null
  limit greatest(1, least(coalesce(p_limit, 200), 500))
$$;

revoke execute on function public.workers_pending_unlock_notification(integer) from public, anon, authenticated;
grant execute on function public.workers_pending_unlock_notification(integer) to service_role;

create or replace function public.record_worker_unlock_notified(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  update public.profiles set unlock_notified_at = now() where id = p_profile_id;

  perform public.notify(
    p_profile_id, 'paid_missions_unlocked', 'Tes missions rémunérées sont débloquées 🎉',
    'Ton activité est validée. Tu peux maintenant postuler aux missions rémunérées sur UROSI.',
    jsonb_build_object('profile_id', p_profile_id)
  );
end;
$$;

revoke execute on function public.record_worker_unlock_notified(uuid) from public, anon, authenticated;
grant execute on function public.record_worker_unlock_notified(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Regression Stripe (requirements a nouveau dus) : deja pris en charge
--    par compute_worker_paid_status via stripe_payouts_enabled — cette RPC
--    ne fait que poser stripe_requirements_pending, lu par useWorkerAccess
--    pour distinguer "jamais complete" de "regression apres deblocage".
-- ---------------------------------------------------------------------------
create or replace function public.set_worker_stripe_requirements_pending(p_account_id text, p_pending boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  update public.profiles
  set stripe_requirements_pending = p_pending
  where stripe_account_id = p_account_id;
end;
$$;

revoke execute on function public.set_worker_stripe_requirements_pending(text, boolean) from public, anon, authenticated;
grant execute on function public.set_worker_stripe_requirements_pending(text, boolean) to service_role;
