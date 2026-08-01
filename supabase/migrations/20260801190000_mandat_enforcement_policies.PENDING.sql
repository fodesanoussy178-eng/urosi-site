-- ⚠️ NE PAS APPLIQUER EN PRODUCTION AVANT QUE L'ECRAN D'ACCEPTATION DU
-- MANDAT SOIT DEPLOYE ET BRANCHE SUR main.
--
-- Etat au 2026-08-01 :
--   staging  → APPLIQUEE (c'est la qu'on valide le parcours)
--   prod     → appliquee puis retiree, faute de composant front. Personne ne
--              pouvait accepter, donc plus personne ne pouvait candidater ni
--              publier.
--
-- Pourquoi ces policies existent : sans elles, le mandat ne sert a rien au
-- niveau base. Rien n'empeche un appel REST direct de creer une candidature
-- ou une mission sans jamais l'avoir accepte. La case cochee cote front
-- n'est pas une preuve, c'est une politesse.
--
-- RESTRICTIVE et non PERMISSIVE : les policies restrictives s'appliquent en
-- ET avec toutes les permissives existantes. C'est indispensable ici, car
-- `applications` porte deux policies INSERT permissives qui sont en OU entre
-- elles — une garde permissive de plus n'aurait rien garanti.

drop policy if exists mandat_required_to_apply on public.applications;
create policy mandat_required_to_apply
  on public.applications
  as restrictive
  for insert
  to authenticated
  with check (has_active_mandat());

drop policy if exists mandat_required_to_publish on public.missions;
create policy mandat_required_to_publish
  on public.missions
  as restrictive
  for insert
  to authenticated
  with check (has_active_mandat());

-- Retrait d'urgence si besoin :
--   drop policy mandat_required_to_apply on public.applications;
--   drop policy mandat_required_to_publish on public.missions;
