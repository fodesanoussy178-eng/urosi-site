-- Le provisionnement des comptes de test Fondateur (edge function
-- founder-test-mode) tentait d'ecrire directement `profiles`/`structures`
-- via la cle service_role. Deux problemes decouverts en production :
--   1. service_role n'a pas de auth.uid() (pas de session utilisateur) donc
--      is_founder() y est TOUJOURS faux : le trigger
--      guard_structure_verification_fields bloquait systematiquement la
--      creation de la structure de test (founder_bypass=true refuse).
--   2. Rien n'empechait, structurellement, de marquer n'importe quel compte
--      reel comme is_founder_test_account=true par erreur.
--
-- Les deux RPC ci-dessous corrigent cela : appeles avec la VRAIE session du
-- fondateur (jamais service_role), elles verifient assert_founder() (donc
-- is_founder() y est correctement vrai) et n'agissent JAMAIS sur un compte
-- dont l'email n'est pas du domaine interne @urosi.internal reserve aux
-- comptes de test.

create or replace function public.founder_mark_test_account(
  p_user_id uuid,
  p_full_name text,
  p_city text default null,
  p_phone text default null,
  p_bio text default null,
  p_skills text[] default null,
  p_address text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_row public.profiles;
begin
  perform private.assert_founder();

  select email into v_email from auth.users where id = p_user_id;
  if v_email is null or v_email not like '%@urosi.internal' then
    raise exception 'Seuls les comptes du domaine interne de test (@urosi.internal) peuvent etre marques comme compte de test Fondateur.';
  end if;

  update public.profiles
  set is_founder_test_account = true,
      full_name = p_full_name,
      city = coalesce(p_city, city),
      phone = coalesce(p_phone, phone),
      bio = coalesce(p_bio, bio),
      skills = coalesce(p_skills, skills),
      address = coalesce(p_address, address)
  where id = p_user_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.founder_mark_test_account(uuid, text, text, text, text, text[], text) from public, anon;
grant execute on function public.founder_mark_test_account(uuid, text, text, text, text, text[], text) to authenticated;

create or replace function public.founder_provision_test_structure(
  p_owner_id uuid,
  p_name text,
  p_siret text,
  p_about text
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

  -- Trusted-write : la verification d'autorite vient d'assert_founder()
  -- ci-dessus (session reelle du fondateur), pas de ce flag — il ne fait que
  -- lever le garde-fou anti-bypass-client sur les colonnes de verification.
  perform set_config('app.structure_founder_bypass_trusted_write', 'true', true);

  insert into public.structures (owner_id, name, siret, about, founder_bypass, verification_status, verification_method, is_ess)
  values (p_owner_id, p_name, p_siret, p_about, true, 'founder_bypass', 'founder', false)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.founder_provision_test_structure(uuid, text, text, text) from public, anon;
grant execute on function public.founder_provision_test_structure(uuid, text, text, text) to authenticated;

create or replace function public.guard_structure_verification_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    new.founder_bypass is true
    or new.verification_status = 'founder_bypass'
    or new.verification_method = 'founder'
  )
  and not public.is_founder()
  and coalesce(current_setting('app.structure_founder_bypass_trusted_write', true), '') <> 'true'
  then
    raise exception using
      errcode = '42501',
      message = 'Acces fondateur requis pour ce contournement.';
  end if;
  return new;
end;
$$;
