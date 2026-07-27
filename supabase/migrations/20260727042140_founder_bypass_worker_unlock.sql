-- Bypass "creation d'entreprise" pour un compte de test travailleur : le
-- vrai deblocage (paid_status='paid_eligible') exige un SIRET verifie
-- aupres du vrai registre Sirene et un onboarding Stripe Connect reel
-- (compute_worker_paid_status, migration 20260726110859), deux etapes
-- impossibles a simuler legitimement pour un compte fictif. Cette RPC pose
-- directement des valeurs sentinelles equivalentes pour un compte deja
-- marque is_founder_test_account — jamais utilisable sur un vrai compte,
-- meme par le fondateur lui-meme (pas de parametre cible : agit uniquement
-- sur l'appelant), et sans jamais toucher Stripe ni le registre officiel.
create or replace function public.founder_bypass_worker_unlock()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_test boolean;
  v_owner_key text;
begin
  select is_founder_test_account into v_is_test
  from public.profiles where id = (select auth.uid());

  if not coalesce(v_is_test, false) then
    raise exception 'Reserve aux comptes de test Fondateur.';
  end if;

  v_owner_key := replace((select auth.uid())::text, '-', '');

  update public.profiles
  set siret = coalesce(siret, '12345678900015'),
      siret_verified_at = coalesce(siret_verified_at, now()),
      stripe_account_id = coalesce(stripe_account_id, 'founder_test_acct_' || v_owner_key),
      stripe_payouts_enabled = true,
      stripe_requirements_pending = false
  where id = (select auth.uid());
end;
$$;

revoke execute on function public.founder_bypass_worker_unlock() from public, anon;
grant execute on function public.founder_bypass_worker_unlock() to authenticated;
