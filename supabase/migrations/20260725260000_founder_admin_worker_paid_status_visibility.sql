-- Observabilite Fondateur du deblocage des missions remunerees (MODULE 3).
--
-- Le centre Fondateur (founder_admin_accounts) n'exposait rien sur
-- paid_status/SIRET/Stripe : le Fondateur n'avait aucun moyen d'observer ou
-- de tester ce qui se passe cote travailleur. On ajoute une lecture seule --
-- paid_status reste toujours derive par compute_worker_paid_status
-- (20260725250000) et n'est jamais ecrit ici. Le Fondateur observe et teste
-- (via le mode test existant), il ne contourne jamais la policy RLS
-- "applications: worker apply" pour faire candidater un travailleur non
-- eligible.

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
           p.paid_status, p.siret, p.siret_verified_at, p.stripe_payouts_enabled,
           p.stripe_requirements_pending, p.unlocked_at,
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
