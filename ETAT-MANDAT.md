# Mandat — etat au 1er aout 2026

Ces migrations ont ete appliquees directement en base. Ces fichiers existent
pour que le depot reflete l'etat reel, pas pour etre rejoues tels quels.

| Fichier | prod | staging |
|---|---|---|
| `20260801175646_mandat_acceptances.sql` | appliquee | deja presente |
| `20260801182406_has_active_mandat.sql` | appliquee | appliquee |
| `20260801190000_mandat_enforcement_policies.PENDING.sql` | **retiree** | appliquee |

Renomme le troisieme fichier en retirant `.PENDING` le jour ou tu l'appliques
en prod.

## Ce qui reste a faire

1. ~~**L'ecran d'acceptation.**~~ Fait, sur `v2` :
   `src/features/auth/MandatAcceptancePage.tsx`, gate posee dans
   `src/features/auth/AuthContext.tsx` (`mandatAccepted`/`mandatError`,
   verifies via `has_active_mandat()`) et branchee dans `src/App.tsx` entre le
   chargement du profil et l'acces aux routes `/app` et `/fondateur`. Aucun
   bypass fondateur : `is_founder_test_account` n'entre dans aucune condition
   du gate, un compte de test suit exactement le meme chemin qu'un compte
   reel. La table est toujours vide en prod comme en staging tant que
   personne n'est passe par l'ecran.

2. **Le role est `structure_admin`**, pas `structure`. La contrainte CHECK et
   la policy le verifient toutes les deux : un composant qui envoie
   `structure` echouera deux fois plutot qu'une. `MandatAcceptancePage` lit
   `profile.role` (type `ProfileRole`, qui n'admet que `worker` et
   `structure_admin`) et l'envoie tel quel — pas de chaine ecrite a la main.

3. **Placement** : entre la verification email et l'acces a l'espace
   (`/app`, `/fondateur`). Les routes utilitaires (pointage, scan, paiement,
   reinitialisation…) restent joignables sans mandat, elles ne donnent pas
   acces a un espace.

4. **Une fois deploye** : appliquer la migration PENDING (retirer le
   suffixe), puis verifier qu'une candidature passe avec mandat et echoue
   sans.

## Deux choses vues au passage, non corrigees

**Faille RLS sur `applications`.** Deux policies INSERT permissives, donc en
OU. `applications: worker apply` verifie que la mission est ouverte et que le
travailleur est eligible aux missions remunerees ; `workers create
applications` ne verifie que `worker_id = auth.uid()`. La seconde annule la
premiere : un travailleur sans statut independant peut candidater a une
mission remuneree par appel direct. Meme schema sur les UPDATE
(`participants update applications` face aux deux policies etroites).

Non corrige parce que supprimer une policy peut casser un flux invisible
depuis la base — a trancher avec le code sous les yeux.

**Policy morte sur `missions`.** `structure owners can create missions`
reference encore `legacy_20260715.structures`. Elle ne peut jamais
correspondre, donc inoffensive, mais elle traine alors que le nettoyage des
policies legacy etait cense etre fait.
