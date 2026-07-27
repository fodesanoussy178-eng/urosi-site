-- is_founder_test_viewer() rendait les missions de test visibles des que
-- has_founder_access() est vrai — donc aussi sur le VRAI compte personnel
-- du fondateur, en navigation normale (pas en mode test/impersonation),
-- exactement comme un utilisateur reel le verrait dans son propre flux
-- "Missions". C'est ce qui faisait apparaitre "Bistrot Fictif Test SARL" /
-- "Epicerie Solidaire des Tanneurs" sur urosi.fr pour le fondateur alors
-- qu'il navigue avec son compte reel.
--
-- Les missions de test ne doivent etre visibles QUE quand le profil
-- CONNECTE est lui-meme un compte de test (is_founder_test_account) —
-- c'est-a-dire uniquement apres bascule via "Tester" dans le Centre
-- Fondateur, jamais sur le compte personnel du fondateur. La supervision
-- des missions de test reste possible via les panneaux du Centre Fondateur
-- (RPC security definer, qui contournent RLS et ne dependent pas de cette
-- fonction).
create or replace function public.is_founder_test_viewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.profiles where id = (select auth.uid()) and is_founder_test_account
  )
$$;
