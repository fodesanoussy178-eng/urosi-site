-- Classification officielle association/entreprise : ne DOIT jamais etre un
-- choix declaratif de la structure a l'inscription — uniquement deduite du
-- registre officiel (categorie juridique INSEE) lors de la verification SIRET.

alter table public.structures add column if not exists structure_type text;
alter table public.structures add column if not exists legal_category_code text;
alter table public.structures add column if not exists is_association boolean not null default false;
alter table public.structures add column if not exists is_verified boolean not null default false;

alter table public.structures drop constraint if exists structures_structure_type_check;
alter table public.structures
  add constraint structures_structure_type_check
  check (structure_type is null or structure_type in ('entreprise', 'association', 'entrepreneur_individuel', 'autre'));

-- Etend le garde-fou des champs officiels aux nouvelles colonnes derivees.
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
      or new.structure_type is distinct from old.structure_type
      or new.legal_category_code is distinct from old.legal_category_code
      or new.is_association is distinct from old.is_association
      or new.is_verified is distinct from old.is_verified
      or new.is_ess is distinct from old.is_ess
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
    founder_bypass, verified_at, verified_by, siret_verified_at,
    structure_type, legal_category_code, is_association, is_verified, is_ess
  on public.structures
  for each row execute function public.guard_structure_verification_fields();

-- apply_structure_siret_verification : ajoute la deduction association/type.
-- Regle : categorie juridique INSEE commencant par '92' = association
-- (declaree ou non), '1' = entrepreneur individuel ; sinon entreprise.
-- Jamais une case a cocher cote structure.
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
  p_payload jsonb default null,
  p_legal_category_code text default null
)
returns public.structures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.structures;
  v_structure_type text;
  v_is_association boolean;
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

  if v_row.verification_method = 'founder' then
    return v_row;
  end if;

  v_is_association := p_legal_category_code like '92%';
  v_structure_type := case
    when p_legal_category_code is null then null
    when v_is_association then 'association'
    when p_legal_category_code like '1%' then 'entrepreneur_individuel'
    else 'entreprise'
  end;

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
      siret_verified_at = case when p_status = 'verified' then now() else siret_verified_at end,
      is_verified = (p_status = 'verified'),
      legal_category_code = coalesce(p_legal_category_code, legal_category_code),
      structure_type = coalesce(v_structure_type, structure_type),
      is_association = coalesce(v_is_association, is_association),
      is_ess = coalesce(v_is_association, is_ess)
  where id = p_structure_id
  returning * into v_row;

  insert into public.structure_verification_checks (structure_id, siret, result_status, source, raw_summary, checked_by)
  values (p_structure_id, v_row.siret, p_status, 'siret_api', p_payload, auth.uid());

  return v_row;
end;
$$;

revoke execute on function public.apply_structure_siret_verification(
  uuid, text, text, text, text, text, text, text, text, text, text, date, jsonb, text
) from public, anon;
grant execute on function public.apply_structure_siret_verification(
  uuid, text, text, text, text, text, text, text, text, text, text, date, jsonb, text
) to authenticated;

-- L'ancienne surcharge (sans p_legal_category_code) devient orpheline :
-- l'edge function est mise a jour pour appeler la nouvelle signature.
drop function if exists public.apply_structure_siret_verification(
  uuid, text, text, text, text, text, text, text, text, text, text, date, jsonb
);

-- founder_provision_test_structure : les comptes de test recoivent aussi une
-- classification association/type coherente, sans jamais appeler le registre.
drop function if exists public.founder_provision_test_structure(
  uuid, text, text, text, text, text, text, text, text, text, text, text, date
);

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
  p_established_at date default null,
  p_structure_type text default 'entreprise',
  p_legal_category_code text default null,
  p_is_association boolean default false
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
    admin_state, siret_checked_at, structure_type, legal_category_code, is_association, is_verified
  )
  values (
    p_owner_id, p_name, p_siret, p_about, true, 'founder_bypass', 'founder', p_is_association,
    p_siren, p_trade_name, p_naf_code, p_naf_label, p_legal_form, p_postal_code, p_city, p_address, p_established_at,
    'A', now(), p_structure_type, p_legal_category_code, p_is_association, true
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.founder_provision_test_structure(
  uuid, text, text, text, text, text, text, text, text, text, text, text, date, text, text, boolean
) from public, anon;
grant execute on function public.founder_provision_test_structure(
  uuid, text, text, text, text, text, text, text, text, text, text, text, date, text, text, boolean
) to authenticated;
