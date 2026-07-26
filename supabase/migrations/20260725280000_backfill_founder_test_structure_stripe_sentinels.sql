-- Backfill : les structures de test Fondateur creees AVANT la migration
-- 20260725270000_founder_test_multi_account_and_card_bypass.sql n'ont jamais
-- recu les identifiants Stripe sentinelles, car founder_provision_test_structure
-- retourne tot ("select ... if v_row.id is not null then return v_row") pour
-- une structure deja existante, sans jamais atteindre l'INSERT qui les pose.
-- On les complete ici directement, uniquement si absents (coalesce), pour ne
-- jamais ecraser un identifiant Stripe deja renseigne.
update public.structures s
set stripe_customer_id = coalesce(s.stripe_customer_id, 'founder_test_cus_' || replace(s.owner_id::text, '-', '')),
    stripe_default_payment_method_id = coalesce(s.stripe_default_payment_method_id, 'founder_test_pm_' || replace(s.owner_id::text, '-', ''))
from public.profiles p
where p.id = s.owner_id
  and p.is_founder_test_account
  and (s.stripe_customer_id is null or s.stripe_default_payment_method_id is null);
