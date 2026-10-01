# UROSI — Audit Phase 0 (missions solidaires)

Audit réalisé avant l'implémentation. Rien n'est supprimé : la couche
rémunérée est mise en sommeil derrière des feature flags (`src/lib/features.ts`).

## Principe retenu

- `VITE_FEATURE_PAID_LAYER` (défaut `false`) : réactive d'un coup toute la
  couche rémunérée (wallet, Stripe, mandat, déblocage, missions rémunérées,
  démo historique, espace travailleur complet `WorkerApp`).
- `VITE_FEATURE_QR_ATTENDANCE` (défaut `false`) : réactive le pointage QR
  (phase 1, missions natives UROSI).
- Aucune donnée, table, fonction SQL, Edge Function ou composant financier
  n'est supprimé.

## 1. Conservé tel quel

| Élément | Où | Pourquoi |
|---|---|---|
| Auth Supabase, sessions, reset mot de passe | `features/auth/*` | Inchangé |
| Profils (`profiles`), rôles `worker` / `structure_admin` | DB + `profileService` | Les rôles restent techniques, seul le vocabulaire visible change |
| Structures + vérification SIRET officielle | `structureService`, `verify-structure`, `verification.ts` | C'est exactement la « structure vérifiée » de la phase 0 |
| Missions natives + candidatures (`missions`, `applications`) | `missionsService`, `applicationsService` | Base des `urosi_solidarity_mission` |
| Règle « mission solidaire = association uniquement » + attestation « ne remplace pas un poste salarié » | trigger `enforce_solidaire_association_only` | Garde-fou légal du bénévolat — **à garder** (voir point ⚠️ plus bas) |
| Notes bidirectionnelles, publication croisée, modération | `ratings`, `rating_requests`, `ratingsService` | Déjà la logique voulue : structure ↔ participant après mission |
| Statut CV (`cv_status` : pending_verification → verified / disputed / rejected) | `applications`, `missionCvService` | Devient le cœur de « Expérience vérifiée » |
| Messagerie par mission, notifications temps réel | `ChatSheet`, `NotificationBell` | Utiles tels quels |
| Signalements, retards, annulation sans pénalité | `attendanceService`, `feedbackService` | Confiance |
| Centre Fondateur, KYC review, mode test | `features/founder/*` | Outil interne, jamais public |
| Moteur de fiabilité (`reliability_index`, `reliability_events`) | DB | Reste en backend, n'est plus mis en avant |
| Thème, logo, typo DM Sans, tokens de couleur | `theme.ts`, `styles.css`, `Logo.tsx` | Identité visuelle inchangée |

## 2. Caché par feature flag (mis en sommeil)

| Élément | Flag | Remarque |
|---|---|---|
| `WorkerApp` (flux avec montants, wallet, KYC IBAN, pointage QR, déblocage) | `paidLayer` | Remplacé en phase 0 par `ParticipantApp` ; le fichier n'est pas modifié |
| `UnlockPaidMissions`, `useWorkerAccess`, `MissionActionButton` « Débloquer » | `paidLayer` | Plus rendus |
| `WalletCard`, `StatsPanel` financier, « Dépenses » | `paidLayer` | Masqués dans l'espace structure |
| Paiement Stripe à l'acceptation, remboursement, moyen de paiement structure | `paidLayer` (+ `VITE_STRIPE_ENABLED`) | Les missions solidaires n'y passaient déjà pas |
| Tarif / commission / coût total dans la publication | `paidLayer` | La publication devient 100 % solidaire |
| Écran d'acceptation du mandat (art. 1984) | `paidLayer` | Voir ⚠️ staging |
| Routes `/paiement/*` | `paidLayer` | |
| Démo historique (`DemoExperience`, montants, wallet) | `paidLayer` | `/demo` ouvre le flux public des missions en phase 0 |
| Pointage QR (worker + scan structure + code de secours) | `qrAttendance` | Architecture intacte, routes `/scan`, `/valider`, `/validation` conservées |
| Remplacement payé, « Voir le paiement », file d'attente payée | `paidLayer` | |
| `DocModal` / `AideRegles` (texte « modèle mandataire ») | `paidLayer` | |
| Statut « Micro-entrepreneur », nom légal « KYC, paiement » dans les réglages | `paidLayer` | |
| Notifications de type `payment` | `paidLayer` | Filtrées à l'affichage |

## 3. Renommé (vocabulaire visible uniquement)

| Avant | Après |
|---|---|
| Travailleur | Participant (côté participant) / bénévole (côté structure) |
| Je cherche des renforts | Je cherche des bénévoles |
| Trouver du travail flexible | Découvrir des missions solidaires près de chez moi… |
| CV vivant | Parcours / CV UROSI |
| Flux / Wallet | Accueil / Missions / Favoris / Profil |
| Accepter (mission) | Candidater (native) · Candidater ↗ (externe) |
| « paiement J+3 » | « Mission réalisée » |
| Habitués | Bénévoles fidèles |
| « avec ton salarié » (notification SQL) | « avec {prénom} » (migration) |

Les valeurs techniques (`worker`, `structure_admin`, `worker_id`…) ne changent
pas : les renommer imposerait une migration lourde sans bénéfice utilisateur.

## 4. Réellement modifié

- **Landing** (`index.html`) : reprise de la maquette, plus aucun montant,
  maquette téléphone statique à la place de l'iframe de la démo payante.
- **Choix du rôle** (`EntryPage`) : deux cartes de la maquette.
- **Inscription participant** : prénom, nom ou initiale, email, mot de passe,
  ville, centres d'intérêt facultatifs. Photo facultative ajoutée ensuite
  depuis le profil, avatar généré sinon. Aucun document, IBAN, Stripe, SIRET.
- **Inscription structure** : texte d'onboarding phase 0, plus de mention
  mandataire / subordination.
- **Nouvel espace participant** `ParticipantApp` : Accueil, Missions,
  Favoris, Profil (Mon parcours, Mes candidatures, Mes avis, Mon CV,
  Paramètres), fiche mission, suivi de candidature en timeline, CV PDF.
- **Modèle de mission unifié** (`solidarityMissions.ts`) :
  `external_solidarity_mission` | `urosi_solidarity_mission` | `paid_mission`
  (`paid_mission` filtré tant que `paidLayer` est coupé).
- **Candidature externe** : trace `external_application_started` enregistrée
  avant la redirection vers la plateforme d'origine.
- **Espace structure** : publication solidaire uniquement, « Confirmer la
  participation » (validation à distance existante) remplace le pointage QR,
  suppression visuelle de tout montant.
- **Profil** : faits (missions, heures, structures, avis, moyenne) au lieu
  d'un score ; distinction stricte déclaré / vérifié.

## 5. Migrations DB strictement nécessaires

Fichier unique : `supabase/migrations/20260926120000_phase0_solidarity_missions.sql`

1. `external_missions` — missions importées (API Engagement et futures
   sources). Lecture publique des missions actives, écriture service_role.
2. `external_applications` — trace des candidatures externes (user, mission,
   source, date du clic, statut). Un participant ne peut **jamais** s'auto-
   attribuer `verified` (trigger de garde) ; seule la vérification UROSI
   (fondateur / service_role) le peut via `founder_verify_external_application`.
3. `profiles.avatar_url`, `profiles.interests` + bucket public `avatars`
   (photo facultative).
4. Correction du texte de notification « avec ton salarié ».

Non nécessaires en phase 0 (volontairement pas faits) : colonne
`mission_kind` sur `missions` (dérivée de `is_solidaire`), table de favoris
(stockage local par appareil), renommage des rôles.

## Mise à jour du 27/09/2026

- Mandat : section 6 de la migration phase 0 — jamais exigé pour une mission
  solidaire (candidature ou publication) ; conservé pour les missions
  rémunérées. Le fichier `.PENDING` est marqué comme remplacé.
- CGU, confidentialité, mentions légales réécrites pour la phase 0.
- Import API Engagement vérifié sur la documentation officielle :
  `docs/api-engagement.md`. Rapport de tests : `docs/phase0-validation.md`.

## ⚠️ Points à trancher par toi (état initial de l'audit)

1. **Mandat en staging.** La policy restrictive `mandat_required_to_apply` /
   `mandat_required_to_publish` (fichier `.PENDING`) est appliquée en
   staging. Avec l'écran mandat masqué, plus personne ne peut candidater ni
   publier sur staging. Il faut soit retirer ces deux policies en staging
   (commande de retrait déjà écrite en bas du fichier), soit réactiver
   `paidLayer` sur staging. Je ne l'ai **pas** fait moi-même.
2. **Associations uniquement.** En base, une mission solidaire (0 €) ne peut
   être publiée que par une structure classée association par le registre
   officiel. Une entreprise vérifiée ne pourra donc rien publier en phase 0.
   Je conseille de garder cette règle (bénévolat en entreprise = risque de
   requalification) ; l'interface l'explique clairement.
3. **CGU / confidentialité** (`cgu.html`, `confidentialite.html`) parlent
   encore de mandat, paiement, travailleur indépendant. Ce sont des textes
   juridiques : je ne les ai pas réécrits, ils doivent l'être par toi / ton
   conseil avant ouverture publique.
4. **Import API Engagement.** L'Edge Function `import-api-engagement` est
   prête mais nécessite la clé `API_ENGAGEMENT_KEY` et une planification
   (cron). Les noms de champs de l'API sont à vérifier sur leur documentation
   avant la mise en production.
5. **Vérification des missions externes.** Aucune plateforme partenaire ne
   renvoie de confirmation : une expérience externe reste « déclarée » tant
   que l'équipe UROSI ne l'a pas vérifiée (RPC fondateur fournie, pas encore
   d'écran dans le Centre Fondateur).
