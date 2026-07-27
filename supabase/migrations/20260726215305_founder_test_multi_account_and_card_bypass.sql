-- Fondateur : comptes de test multiples + bypass carte bancaire (Module 2).
--
-- 1. Une structure de test Fondateur (is_founder_test_account=true) n'a
--    jamais de vraie carte : ses missions doivent se comporter comme si
--    aucune autorisation bancaire n'etait requise, sans jamais toucher
--    Stripe. missions_set_authorization_requirement decide 'not_required'
--    vs 'pending' a l'INSERT ; on y ajoute le cas structure de test, en
--    reutilisant is_founder_test_mission (deja en place, meme jointure).
--    Consequence : ces missions ne sont JAMAIS selectionnees par
--    missions_due_for_authorization ('pending' uniquement) donc jamais
--    d'appel Stripe, quel que soit l'etat des secrets Stripe du projet.
create or replace function public.missions_set_authorization_requirement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.payment_authorization_status :=
      case
        when new.is_solidaire or coalesce(new.worker_rate_cents, 0) <= 0 then 'not_required'
        when public.is_founder_test_mission(new.structure_id) then 'not_required'
        else 'pending'
      end;
  end if;
  return new;
end;
$$;

-- Backfill : une mission de structure de test deja creee avant ce correctif
-- peut etre restee bloquee (statut fige a l'INSERT, jamais retroactif).
update public.missions
set payment_authorization_status = 'not_required'
where public.is_founder_test_mission(structure_id)
  and payment_authorization_status in ('pending', 'requires_action', 'failed');

-- 2. founder_provision_test_structure pose desormais des identifiants
--    Stripe SENTINELLES (jamais crees cote Stripe, jamais utilises : cf.
--    point 1 ci-dessus) pour que l'ecran "ajoute ta carte" du frontend
--    (structure.stripe_default_payment_method_id non nul) ne s'affiche
--    jamais pour une structure de test. Uniques par construction
--    (structures_stripe_customer_id_key est un index unique reel).
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
  v_owner_key text;
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
  v_owner_key := replace(p_owner_id::text, '-', '');

  insert into public.structures (
    owner_id, name, siret, about, founder_bypass, verification_status, verification_method, is_ess,
    siren, trade_name, naf_code, naf_label, legal_form, postal_code, city, address, siret_established_at,
    admin_state, siret_checked_at, structure_type, legal_category_code, is_association, is_verified,
    stripe_customer_id, stripe_default_payment_method_id
  )
  values (
    p_owner_id, p_name, p_siret, p_about, true, 'founder_bypass', 'founder', p_is_association,
    p_siren, p_trade_name, p_naf_code, p_naf_label, p_legal_form, p_postal_code, p_city, p_address, p_established_at,
    'A', now(), p_structure_type, p_legal_category_code, p_is_association, true,
    'founder_test_cus_' || v_owner_key, 'founder_test_pm_' || v_owner_key
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

-- 3. Liste des comptes de test existants (pour le panneau Fondateur) :
--    un compte de test peut desormais exister en plusieurs exemplaires par
--    role, il faut pouvoir les enumerer pour y basculer individuellement.
create or replace function public.founder_test_accounts_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_founder();
  return jsonb_build_object(
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', u.email, 'created_at', p.created_at
      ) order by p.created_at)
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.is_founder_test_account and p.role = 'worker'
    ), '[]'::jsonb),
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', u.email, 'created_at', p.created_at,
        'structure_id', s.id, 'structure_name', s.name
      ) order by p.created_at)
      from public.profiles p
      join auth.users u on u.id = p.id
      left join public.structures s on s.owner_id = p.id
      where p.is_founder_test_account and p.role = 'structure_admin'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.founder_test_accounts_list() from public, anon;
grant execute on function public.founder_test_accounts_list() to authenticated;
