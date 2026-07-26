-- Verification officielle des structures francaises via l'API publique
-- "Recherche d'entreprises" (api.gouv.fr, source SIRENE/INSEE) :
--   - l'appel a l'API se fait uniquement cote serveur (edge function
--     verify-structure), jamais depuis le navigateur ;
--   - un simple format de SIRET valide (Luhn) n'est JAMAIS considere comme
--     une preuve d'existence : seul un appel reussi au registre officiel
--     peut faire passer une structure a 'verified' ;
--   - les champs officiels (raison sociale, SIRET/SIREN, adresse officielle,
--     NAF, forme juridique, etat administratif...) ne sont modifiables que
--     via la RPC de confiance appelee par cette edge function, jamais par un
--     UPDATE direct du proprietaire ;
--   - chaque verification est journalisee (structure_verification_checks).

-- ---------------------------------------------------------------------------
-- 1. Nouvelles colonnes : donnees officielles + presentation editable
-- ---------------------------------------------------------------------------
alter table public.structures add column if not exists siren text;
alter table public.structures add column if not exists postal_code text;
alter table public.structures add column if not exists city text;
alter table public.structures add column if not exists address text;
alter table public.structures add column if not exists naf_code text;
alter table public.structures add column if not exists naf_label text;
alter table public.structures add column if not exists legal_form text;
alter table public.structures add column if not exists admin_state text;
alter table public.structures add column if not exists siret_established_at date;
alter table public.structures add column if not exists siret_payload jsonb;
alter table public.structures add column if not exists siret_checked_at timestamptz;
-- Presentation : librement modifiables par le proprietaire, jamais issues du registre.
alter table public.structures add column if not exists trade_name text;
alter table public.structures add column if not exists logo_url text;

-- ---------------------------------------------------------------------------
-- 2. Statuts etendus : Verifiee / A verifier (pending) / Fermee / Introuvable
-- ---------------------------------------------------------------------------
alter table public.structures drop constraint if exists structures_verification_status_check;
alter table public.structures
  add constraint structures_verification_status_check
  check (verification_status in ('pending', 'verified', 'rejected', 'closed', 'not_found', 'founder_bypass'));

-- ---------------------------------------------------------------------------
-- 3. Garde-fou : les champs officiels ne sont modifiables que via la RPC de
-- confiance (app.structure_official_write) ou par le fondateur (comptes de
-- test, app.structure_founder_bypass_trusted_write deja en place).
-- ---------------------------------------------------------------------------
create or replace function public.guard_structure_verification_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_founder boolean := public.is_founder();
  v_founder_write boolean := coalesce(current_setting('app.structure_founder_bypass_trusted_write', true), '') = 'true';
  v_official_write boolean := coalesce(current_setting('app.structure_official_write', true), '') = 'true';
begin
  if (
    new.founder_bypass is true
    or new.verification_status = 'founder_bypass'
    or new.verification_method = 'founder'
  ) and not v_is_founder and not v_founder_write then
    raise exception using
      errcode = '42501',
      message = 'Acces fondateur requis pour ce contournement.';
  end if;

  if TG_OP = 'UPDATE' and not v_is_founder and not v_official_write and not v_founder_write then
    if new.name is distinct from old.name
      or new.siret is distinct from old.siret
      or new.siren is distinct from old.siren
      or new.postal_code is distinct from old.postal_code
      or new.city is distinct from old.city
      or new.address is distinct from old.address
      or new.naf_code is distinct from old.naf_code
      or new.naf_label is distinct from old.naf_label
      or new.legal_form is distinct from old.legal_form
      or new.admin_state is distinct from old.admin_state
      or new.siret_established_at is distinct from old.siret_established_at
      or new.siret_payload is distinct from old.siret_payload
      or new.siret_checked_at is distinct from old.siret_checked_at
      or new.verification_status is distinct from old.verification_status
      or new.verification_method is distinct from old.verification_method
      or new.verified_at is distinct from old.verified_at
      or new.verified_by is distinct from old.verified_by
      or new.siret_verified_at is distinct from old.siret_verified_at
    then
      raise exception using
        errcode = '42501',
        message = 'Ces informations proviennent du registre officiel : utilise la verification SIRET pour les mettre a jour.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists structures_guard_verification on public.structures;
create trigger structures_guard_verification
  before insert or update of
    name, siret, siren, postal_code, city, address, naf_code, naf_label,
    legal_form, admin_state, siret_established_at, siret_payload,
    siret_checked_at, verification_status, verification_method,
    founder_bypass, verified_at, verified_by, siret_verified_at
  on public.structures
  for each row execute function public.guard_structure_verification_fields();

-- ---------------------------------------------------------------------------
-- 4. Journal d'audit : chaque verification (succes ou echec) est tracee.
-- ---------------------------------------------------------------------------
create table if not exists public.structure_verification_checks (
  id bigint generated by default as identity primary key,
  structure_id uuid not null references public.structures (id) on delete cascade,
  siret text,
  result_status text not null check (result_status in ('verified', 'pending', 'closed', 'not_found')),
  source text not null default 'siret_api' check (source in ('siret_api', 'founder', 'manual')),
  raw_summary jsonb,
  checked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists structure_verification_checks_structure_idx
  on public.structure_verification_checks (structure_id, created_at desc);

alter table public.structure_verification_checks enable row level security;

drop policy if exists "structure verification checks: owner or founder read" on public.structure_verification_checks;
create policy "structure verification checks: owner or founder read"
  on public.structure_verification_checks for select
  to authenticated
  using (
    (select public.is_founder())
    or exists (
      select 1 from public.structures s
      where s.id = structure_verification_checks.structure_id and s.owner_id = auth.uid()
    )
  );

revoke all on table public.structure_verification_checks from public, anon;
grant select on table public.structure_verification_checks to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC : ecriture de confiance du resultat de verification SIRET, appelee
-- par l'edge function verify-structure via le JWT du proprietaire (jamais
-- via service_role : is_founder()/ownership doivent rester evaluables).
-- ---------------------------------------------------------------------------
create or replace function public.apply_structure_siret_verification(
  p_structure_id uuid,
  p_status text,
  p_name text default null,
  p_siren text default null,
  p_postal_code text default null,
  p_city text default null,
  p_address text default null,
  p_naf_code text default null,
  p_naf_label text default null,
  p_legal_form text default null,
  p_admin_state text default null,
  p_established_at date default null,
  p_payload jsonb default null
)
returns public.structures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.structures;
begin
  if p_status not in ('verified', 'pending', 'closed', 'not_found') then
    raise exception using errcode = '22023', message = 'Statut de verification invalide.';
  end if;

  select * into v_row from public.structures where id = p_structure_id;
  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'Structure introuvable.';
  end if;
  if v_row.owner_id <> auth.uid() and not public.is_founder() then
    raise exception using errcode = '42501', message = 'Acces refuse.';
  end if;

  -- Une structure de test Fondateur (verifiee par bypass) n'est jamais
  -- retrogradee par un appel de verification SIRET classique.
  if v_row.verification_method = 'founder' then
    return v_row;
  end if;

  perform set_config('app.structure_official_write', 'true', true);

  update public.structures
  set name = coalesce(p_name, name),
      siren = coalesce(p_siren, siren),
      postal_code = coalesce(p_postal_code, postal_code),
      city = coalesce(p_city, city),
      address = coalesce(p_address, address),
      naf_code = coalesce(p_naf_code, naf_code),
      naf_label = coalesce(p_naf_label, naf_label),
      legal_form = coalesce(p_legal_form, legal_form),
      admin_state = coalesce(p_admin_state, admin_state),
      siret_established_at = coalesce(p_established_at, siret_established_at),
      siret_payload = coalesce(p_payload, siret_payload),
      siret_checked_at = now(),
      verification_status = p_status,
      verification_method = 'siret',
      verified_at = case when p_status = 'verified' then now() else null end,
      siret_verified_at = case when p_status = 'verified' then now() else siret_verified_at end
  where id = p_structure_id
  returning * into v_row;

  insert into public.structure_verification_checks (structure_id, siret, result_status, source, raw_summary, checked_by)
  values (p_structure_id, v_row.siret, p_status, 'siret_api', p_payload, auth.uid());

  return v_row;
end;
$$;

revoke execute on function public.apply_structure_siret_verification(
  uuid, text, text, text, text, text, text, text, text, text, text, date, jsonb
) from public, anon;
grant execute on function public.apply_structure_siret_verification(
  uuid, text, text, text, text, text, text, text, text, text, text, date, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC : (re)soumission d'un SIRET par le proprietaire. Le format Luhn n'est
-- qu'un pre-filtre pour eviter un appel API inutile — jamais une preuve.
-- ---------------------------------------------------------------------------
create or replace function public.resubmit_structure_siret(p_structure_id uuid, p_siret text)
returns public.structures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.structures;
  v_digits text := regexp_replace(coalesce(p_siret, ''), '\D', '', 'g');
begin
  if length(v_digits) <> 14 then
    raise exception using errcode = '22023', message = 'Le SIRET doit contenir 14 chiffres.';
  end if;

  select * into v_row from public.structures where id = p_structure_id;
  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'Structure introuvable.';
  end if;
  if v_row.owner_id <> auth.uid() and not public.is_founder() then
    raise exception using errcode = '42501', message = 'Acces refuse.';
  end if;
  if v_row.verification_method = 'founder' then
    raise exception using errcode = '42501', message = 'Un compte de test Fondateur ne se re-verifie pas via un SIRET.';
  end if;

  perform set_config('app.structure_official_write', 'true', true);

  update public.structures
  set siret = v_digits,
      verification_status = 'pending',
      verification_method = 'siret',
      siret_checked_at = null,
      verified_at = null,
      siret_verified_at = null
  where id = p_structure_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.resubmit_structure_siret(uuid, text) from public, anon;
grant execute on function public.resubmit_structure_siret(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Une structure fermee ou introuvable ne doit jamais pouvoir publier de
-- mission : verrou serveur, pas seulement une verification client.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_structure_verified_for_missions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if public.is_founder() then
    return new;
  end if;
  select verification_status into v_status from public.structures where id = new.structure_id;
  if v_status not in ('verified', 'founder_bypass') then
    raise exception 'Structure non verifiee ou fermee : impossible de publier une mission.';
  end if;
  return new;
end;
$$;

drop trigger if exists missions_require_verified_structure on public.missions;
create trigger missions_require_verified_structure
  before insert on public.missions
  for each row execute function public.enforce_structure_verified_for_missions();

revoke execute on function public.enforce_structure_verified_for_missions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Founder test mode : simuler un profil officiel complet, fictif, sans
-- jamais appeler la vraie API (le domaine reserve @urosi.internal garantit
-- l'isolation, cf. migration 20260724180000).
-- ---------------------------------------------------------------------------
-- Remplace par une version acceptant les champs officiels fictifs ci-dessous
-- (signature differente = surcharge distincte en Postgres, pas un remplacement).
drop function if exists public.founder_provision_test_structure(uuid, text, text, text);

create or replace function public.founder_provision_test_structure(
  p_owner_id uuid,
  p_name text,
  p_siret text,
  p_about text,
  p_siren text default null,
  p_trade_name text default null,
  p_naf_code text default null,
  p_naf_label text default null,
  p_legal_form text default null,
  p_postal_code text default null,
  p_city text default null,
  p_address text default null,
  p_established_at date default null
)
returns public.structures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_row public.structures;
begin
  perform private.assert_founder();

  select email into v_email from auth.users where id = p_owner_id;
  if v_email is null or v_email not like '%@urosi.internal' then
    raise exception 'Seuls les comptes du domaine interne de test (@urosi.internal) peuvent recevoir une structure de test Fondateur.';
  end if;

  select * into v_row from public.structures where owner_id = p_owner_id;
  if v_row.id is not null then
    return v_row;
  end if;

  perform set_config('app.structure_founder_bypass_trusted_write', 'true', true);

  insert into public.structures (
    owner_id, name, siret, about, founder_bypass, verification_status, verification_method, is_ess,
    siren, trade_name, naf_code, naf_label, legal_form, postal_code, city, address, siret_established_at,
    admin_state, siret_checked_at
  )
  values (
    p_owner_id, p_name, p_siret, p_about, true, 'founder_bypass', 'founder', false,
    p_siren, p_trade_name, p_naf_code, p_naf_label, p_legal_form, p_postal_code, p_city, p_address, p_established_at,
    'A', now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.founder_provision_test_structure(
  uuid, text, text, text, text, text, text, text, text, text, text, text, date
) from public, anon;
grant execute on function public.founder_provision_test_structure(
  uuid, text, text, text, text, text, text, text, text, text, text, text, date
) to authenticated;
