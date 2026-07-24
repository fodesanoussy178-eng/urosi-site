-- Bug d'isolation confirme en production : le fondateur voyait les missions
-- de test (structure Bistrot Fictif Test SARL) dans SON PROPRE flux reel,
-- meme hors mode test. Cause : is_founder_test_viewer() traitait
-- has_founder_access() (vrai en permanence sur le compte reel du fondateur)
-- comme une raison suffisante de lever l'isolation, alors que cette
-- exception ne doit s'appliquer qu'a une session qui EST elle-meme un
-- compte de test (bascule "Tester comme Worker/Structure"). Le Centre
-- Fondateur (tableaux de bord) ne depend pas de cette fonction : il lit via
-- des RPC security definer (founder_admin_missions, etc.) qui contournent
-- deja la RLS avec assert_founder().
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
