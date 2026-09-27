# Phase 0 — rapport de validation (27/09/2026)

Aucun déploiement en production n'a été fait. La migration phase 0 n'est
appliquée sur aucune base.

## Comment les tests ont été faits

| Niveau | Méthode | Résultat |
|---|---|---|
| Base de données (RLS, triggers, fonctions) | Bloc SQL exécuté sur le **schéma de production** qui applique la migration, crée 3 vrais comptes de test `@urosi.internal`, joue chaque étape en se faisant passer pour chaque compte, puis **s'annule entièrement** (exception finale). Fichier : `supabase/tests/phase0_e2e_rollback.sql` | 22/22 étapes conformes |
| Interface (build de production, Chromium, mobile 390 px + desktop 1366 px) | Playwright. Supabase est **simulé** (interception réseau) car ce bac à sable ne peut pas joindre `*.supabase.co` | 59/59 vérifications |
| Unitaires | Vitest | 168/168 |

Le staging (`urosi-staging`) n'a pas pu être réactivé : l'offre gratuite limite
à 2 projets actifs (`urosi` et `autour` le sont déjà).

## Parcours vérifiés

**Participant** : inscription (aucun document, IBAN ni SIRET) → profil
(centres d'intérêt, photo facultative) → missions → fiche → « Candidater ↗ » →
trace `external_application_started` enregistrée **avant** l'ouverture du lien
tracké API Engagement → suivi (candidature externe → en attente → acceptée
*déclarée* → réalisée *déclarée*) → auto-vérification refusée par la base →
profil / parcours / CV.

**Structure** : création → vérification SIRET (catégorie 9220 = association)
→ publication d'une mission solidaire **sans mandat** → candidature du
participant **sans mandat** → acceptation → « Confirmer la participation »
(début + fin) → « Valider l'expérience » → avis croisés.

**Garde-fous** : entreprise vérifiée → publication solidaire refusée
(« réservée aux associations ») ; mission rémunérée → refusée (catégorie
verrouillée) ; vue fondateur refusée à un participant ; insertion directe d'un
statut `verified` refusée.

**Interface** : aucun des termes €, Stripe, wallet, IBAN, mandat, commission,
travailleur, rémunération, micro-entrepreneur, subordination, QR n'apparaît sur
la landing, `/missions`, le choix du rôle, les écrans participant et structure,
ni dans les pages CGU / confidentialité / mentions légales (hors négations du
type « aucune rémunération »). `/missions` sans réponse du serveur affiche un
état propre au bout de 8 s au plus.

## Corrigé pendant la validation

1. `/v0/mission/search` renvoie `hits` et non `data` : l'import utilise
   désormais `GET /v0/mission` (réponse `data`), conforme à la documentation.
2. Anonyme : la table `missions` n'est pas lisible → vue publique
   `public_solidarity_missions` (colonnes non sensibles, solidaires ouvertes
   uniquement).
3. Bouton « Valider l'expérience » inatteignable après la confirmation de fin
   (bug antérieur) → ajouté sur la carte de fin de mission.
4. Notifications héritées (« note le travailleur », « CV vivant ») →
   reformulées à l'affichage en phase 0.
