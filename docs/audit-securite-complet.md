# Audit sécurité & production — UROSI (6 volets)

> **Méthode** : lecture du dépôt + interrogation **read-only de la prod Supabase** (`urosi`, `nksxwbkpazcyoumcwzll`) via SQL (`pg_proc`, `pg_policies`, `pg_class`, `storage.buckets`, `cron.job`) + advisors officiels. Aucune modification effectuée.
> **Règle** : chaque affirmation est citée (fichier / migration / policy / fonction / requête). Ce qui n'a pas pu être prouvé est marqué **« non vérifié »**.
> **Contexte** : prod quasi vide au moment de l'audit — `profiles=7, structures=0, missions=0, applications=0, payments=0, wallet_transactions=0, ratings=0` (requête `count(*)`). Le flux argent n'a donc **jamais tourné en prod**.

---

## Volet 1 — Fonctions SECURITY DEFINER (une par une)

**Périmètre prouvé** : 91 fonctions `prosecdef=true` en `public`/`private` (requête `pg_proc … prosecdef=true`). **Aucune n'est exécutable par `anon`** (`has_function_privilege('anon', …)=false` pour toutes). 51 sont exécutables par `authenticated`.

**Méthode de tri** : pour chaque fonction exposée à `authenticated`, scan du source (`pg_get_functiondef`) sur la présence de gardes (`assert_founder`, `is_founder`, `auth.uid()`, `is_structure_owner`, `raise exception`).

### 1.a — Fonctions fondateur (18) → **sûres**
Toutes les `founder_admin_*`, `founder_list_kyc_submissions`, `founder_set_kyc_status`, `has_founder_access`, `is_founder` référencent la garde fondateur.
**Preuve** : `private.assert_founder()` lève `errcode 42501 'Acces fondateur requis.'` si `not public.is_founder()`, et exige `aal2` (MFA) si `founder_settings.require_mfa`. `founder_admin_accounts` fait `perform private.assert_founder();` en première instruction.
→ **Pas d'escalade de privilège** : un utilisateur non-fondateur qui appelle `/rest/v1/rpc/founder_admin_accounts` reçoit une exception.

### 1.b — RPC utilisateur avec garde interne → **sûres (échantillon prouvé)**
`worker_cv(p_worker_id)` : `raise 'Non autorisé'` sauf si `auth.uid() = p_worker_id` **ou** `public.is_my_applicant(p_worker_id)`. → lecture d'un CV limitée au travailleur lui-même ou à une structure dont il est candidat. **Pas d'IDOR.**
Les autres RPC d'action (`confirm_attendance_qr`, `create_mission_qr_token`, `report_*`, `request_remote_attendance`, `submit_worker_kyc`, `subscribe_structure`…) utilisent `auth.uid()` + `raise` (colonne `uses_uid=true, has_raise=true` du scan). Échantillon `worker_cv` confirmé ; le reste **cohérent mais non lu ligne à ligne (à confirmer si besoin de certitude à 100 %)**.

### 1.c — Helpers/prédicats RLS exposés → **faux positifs (hygiène)**
`is_structure_owner`, `owns_mission`, `owns_completed_application`, `can_access_application`, `is_my_applicant`, `mission_is_open`, `structure_has_open_mission` : renvoient un **booléen** sur la relation du seul appelant (via `auth.uid()`). Exposés à `authenticated` mais ne divulguent rien. Recommandé : `revoke execute … from authenticated` pour réduire la surface (non bloquant).

### 1.d — 🟠 Finding réel : `compute_mission_pricing`
**Preuve (source prod)** : la fonction lit `select * from public.pay_rules where structure_id = p_structure_id` **sans aucun contrôle de propriété** (`founder_guard=false, uses_uid=false, owner_check=false, has_raise=false`) et renvoie les règles appliquées (`rule_id, kind, label, amount_cents`).
**Risque** : tout utilisateur `authenticated` peut passer un `p_structure_id` arbitraire et lire la **stratégie tarifaire privée** d'une autre structure (les règles `pay_rules` sont pourtant protégées en accès direct par RLS — cf. volet 2). Pas de PII, pas de mouvement d'argent → **gravité faible/moyenne** (fuite d'info concurrentielle).
**Correctif proposé (uniquement si confirmé côté appelant)** : soit `revoke execute on function public.compute_mission_pricing(...) from authenticated` (si appelée seulement côté serveur/trigger), soit ajouter en tête `if not public.is_structure_owner(p_structure_id) and not public.is_founder() then raise exception 'Non autorisé'; end if;`. **À ne pas appliquer sans vérifier** que l'aperçu tarifaire structure ne l'appelle pas côté client avec son propre `structure_id`.

**Verdict volet 1** : posture solide. **1 finding réel** (`compute_mission_pricing`), + de l'hygiène (helpers exposés). Aucune escalade fondateur, aucun accès anonyme.

---

## Volet 2 — RLS (cloisonnement inter-utilisateurs)

**Preuve** : les **33 tables** de `public` ont `relrowsecurity=true`. Dump complet de `pg_policies`.

| Table | Policy SELECT (USING) — preuve | Cloisonné ? |
|---|---|---|
| `wallets` | `profile_id = auth.uid()` | ✅ |
| `wallet_transactions` | via `wallets.profile_id = auth.uid()` | ✅ |
| `payments` | worker: `applications.worker_id=auth.uid()` ; structure: `owns_mission()` | ✅ |
| `payment_accounts` | `profile_id = auth.uid()` | ✅ |
| `profiles` | `id = auth.uid()` **OU** `is_my_applicant(id)` | ✅ (structure ne voit que ses candidats) |
| `messages` | `can_access_application(application_id)` | ✅ |
| `applications` | worker: `worker_id=auth.uid()` ; structure: `owns_mission()` | ✅ |
| `ratings` | `worker_id=auth.uid()` ou `rls_private.can_rate_finished_application(...)` | ✅ |
| `notifications` | `profile_id = auth.uid()` | ✅ |
| `kyc_status_history` | `profile_id=auth.uid()` OU `is_founder()` | ✅ |
| `pay_rules` | `is_structure_owner(structure_id)` (ALL) | ✅ (mais contourné par `compute_mission_pricing`, cf. 1.d) |
| `reliability_disputes/events`, `reports`, `structure_members`, `mission_reports/_evidence` | propriétaire/participant/sujet | ✅ |
| `founder_admin_log`, `founder_lab_scenarios`, `kyc_document_access_log`, `platform_revenue` | `is_founder()` | ✅ |
| `mission_validation_keys`, `mission_validation_pins`, `attendance_validation_attempts` | policy `USING false / CHECK false` (rôle `authenticated`) | ✅ accès serveur seul |
| `mission_qr_tokens` | **0 policy** (deny-all via API) | ✅ intentionnel |

**Points d'attention (non bloquants, à décider consciemment) :**
- `missions` (`status='open' OR is_structure_owner`), `mission_days` (idem), `structures` (`structure_has_open_mission(id)`) : les missions **ouvertes** et leurs structures sont lisibles **sans `auth.uid()`** → donc potentiellement par le rôle `anon` (clé publishable). Cohérent avec un « annuaire d'offres publiques », mais **à confirmer** comme voulu. *(non vérifié : test effectif avec un jeton anon.)*
- `platform_settings` : lisible par tout `authenticated` (`auth.uid() IS NOT NULL`) — commission %, non sensible.

**Verdict volet 2** : **aucune table ne laisse un `authenticated` lire les données d'un autre utilisateur en accès direct PostgREST.** Le seul contournement est le `SECURITY DEFINER` `compute_mission_pricing` (volet 1.d).

---

## Volet 3 — Flux argent (bout en bout)

**Parcours tracé (avec citations) :**
1. **Création mission** → `missions` INSERT, policy `is_structure_owner` (`pg_policies`).
2. **Candidature** → `applications` INSERT `worker_id=auth.uid() AND mission_is_open()`.
3. **Acceptation** → `applications` UPDATE `owns_mission()`.
4. **Pointage début** → `confirm_attendance_qr` / `validate_mission_attendance_core` → `status='in_progress'` (migration `20260716130000_neutral_payment_wording.sql`).
5. **Pointage fin** → `status='payment_pending'`, `payment_ready_at = now()+interval '3 days'` (même migration).
6. **Libération J+3** → `release_payment_ready_mission(uuid)` (service_role) → trigger `trg_pay_on_completion` → `process_mission_payment` qui insère un paiement `provider='internal'` (`0009_wallet_payments.sql`).
7. **Garde** → `private.guard_simulated_payment` **bloque** tout `provider='internal'` hors staging (`20260715150000_foundation_security_hardening.sql`).

**Où le flux s'arrête aujourd'hui (prouvé) :**
- **Aucun déclencheur J+3** : `cron.job` n'existe pas → **pg_cron non activé** (erreur `relation "cron.job" does not exist`) ; l'edge function `release-due-payments` **n'est pas déployée** (`list_edge_functions` = `verify-structure`, `psp` uniquement).
- **Même déclenchée, elle échouerait** : `guard_simulated_payment` bloque `provider='internal'` en prod.
- **La voie Stripe n'est pas active** : migration `20260719190000_stripe_integration_foundations` **absente de la prod** (`list_migrations`), edge functions `stripe-*` **non déployées**, **aucune clé** configurée.
- **Constat de données** : `payments=0`, `applications=0` → le flux n'a **jamais** produit un paiement.

**Ce qu'il manque pour qu'un vrai euro circule :**
1. Appliquer la migration Stripe en prod (`supabase db push`).
2. Déployer `stripe-connect-onboard/-status/-login/-balance`, `stripe-create-payment`, `stripe-identity-start`, `stripe-webhook`, `release-due-payments`.
3. Configurer les secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) + endpoint webhook.
4. **Brancher l'UI** (onboarding Express + IBAN, Identity, PaymentIntent via Elements).
5. **Planifier** la libération J+3 (Supabase Scheduled Functions ou activer pg_cron + pg_net).
6. Tester en mode test, puis basculer en clés live.
(cf. `docs/stripe-deployment.md`)

---

## Volet 4 — Dépôt GitHub vs Production Supabase

**Migrations** (`list_migrations` vs `supabase/migrations/`) :
- 🔴 **Prod-only, absentes du dépôt** : `20260718091412 enable_bidirectional_ratings_after_attendance`, `20260718091413 secure_rating_authorization_helper`.
- 🟡 **Dépôt-only, absente de la prod** : `20260719190000_stripe_integration_foundations` (attendu, mode test).

**Objets SQL** :
- 🔴 Schéma **`rls_private`** + fonction **`can_rate_finished_application`** présents en prod (utilisés par les policies `ratings`), **absents du dépôt** (`grep rls_private supabase/` = rien). → **Le dépôt ne peut pas reproduire l'autorisation de notation de la prod.**
- ✅ Vues `reliability_index`, `platform_revenue_total` : versionnées (`0002_functions.sql`, `20260715091205…`).
- ✅ Buckets Storage `attendance-evidence` (privé), `kyc-documents` (privé) : policies présentes dans les migrations (`0015`, `0016`, `20260714134755`, `20260715150000`).

**Edge Functions** (`list_edge_functions` vs `supabase/functions/`) :
- 🔴 **`verify-structure`** : **déployée en prod, absente du dépôt** (code de vérification de structure non versionné/non revu).
- ✅ `psp` : déployée (v2) + dans le dépôt.
- 🟡 **`process-spot-offers`** : dans le dépôt, **non déployée** → le mécanisme d'offres/liste d'attente (affiché dans `WorkerApp` via `SpotOfferBanner`) **n'a pas de processeur actif en prod**.
- 🟡 `release-due-payments`, `stripe-*` : dans le dépôt, non déployées (attendu).

**Verdict volet 4** : **NON synchronisés.** Drift réel dans les deux sens. À réconcilier : `supabase db pull` pour rapatrier `rls_private`/ratings, et versionner `verify-structure` (ou le supprimer s'il est obsolète). *(non vérifié : diff exhaustif des corps de fonctions communes — seuls les objets manquants d'un côté ont été prouvés.)*

---

## Volet 5 — Scénarios critiques non testés

Tests existants (12 fichiers) : pricing/commission (`pricingService.test`, `commissionMigration.test`, `commission_18.sql`), auth (`SignInPage`, `WorkerSignupPage`), stats, `format`/`geo`/`slots`, `WalletCard`, démo, `FounderLabPanel`. **Aucun test d'intégration DB / RLS.**

| Scénario | Risque | Test à écrire |
|---|---|---|
| **Paiement / libération J+3** | 🔴 Bloquant | Intégration : mission→pointage→release→`payments` correct, idempotence, commission 18 %. |
| **Isolation RLS inter-comptes** | 🔴 Bloquant | Deux utilisateurs : vérifier qu'aucun ne lit wallet/messages/applications de l'autre (jetons distincts). |
| **Pointage QR + PIN** | 🔴 Bloquant | PIN expiré, mauvais PIN, rejeu de QR, verrouillage après 5 échecs (`attendance_validation_attempts`). |
| **KYC** | 🟠 Important | Soumission, transition de statut, blocage retrait si non vérifié (`require_verified_kyc_for_withdrawal`). |
| **Wallet** | 🟠 Important | Dépôt/retrait, solde négatif impossible, `guard_simulated_payment`. |
| **Annulation** | 🟠 Important | Annulation travailleur/structure, redistribution (spot offers), transitions interdites (`guard_application_state_and_capacity`). |
| **Fraude** | 🟠 Important | Double candidature, dépassement de capacité, `compute_mission_pricing` sur structure d'autrui (cf. 1.d). |
| **compute_mission_pricing IDOR** | 🟠 Important | Confirmer/fermer la fuite de `pay_rules`. |

---

## Volet 6 — Passage à l'échelle (10 000 utilisateurs)

> **Contexte** : prod actuellement vide (0 mission/application). Les points ci-dessous sont **théoriques**, fondés sur les advisors et le code — **non mesurés sous charge (non vérifié)**.

### 🔴 Bloquant
- **Aucun flux argent actif** (volet 3) : à 10 000 utilisateurs, toujours 0 € encaissé/versé tant que Stripe n'est pas branché.
- **Drift de migrations** (volet 4) : impossible de recréer/faire évoluer la prod de façon fiable → risque à chaque déploiement.

### 🟠 Important (perf, advisors prod)
- **`auth_rls_initplan` ×30** : policies utilisant `auth.uid()` non enveloppé → **réévalué par ligne**. Sur des tables volumineuses (missions, applications, notifications), latence SELECT. Correctif : `(select auth.uid())`. *(preuve : advisor performance.)*
- **`unindexed_foreign_keys` ×32** : jointures et cascades lentes à l'échelle. *(advisor.)*
- **`multiple_permissive_policies` ×36** : plusieurs policies évaluées par requête. *(advisor.)*
- **Flux worker chargé côté client** : `WorkerApp` fait `fetchOpenMissions()` puis trie par distance en JS (`distanceKm`, `WorkerApp.tsx`). À grand volume de missions ouvertes, transfert + tri O(n) côté client → pagination/tri serveur nécessaire. *(preuve : code ; impact non mesuré.)*
- **Realtime** : `0012_realtime_missions.sql` active le temps réel sur les missions ; 10 000 abonnés simultanés → charge Realtime à dimensionner. *(non vérifié : config/plan.)*

### 🟢 Amélioration
- 52 index inutilisés (normal à vide, à réévaluer avec du trafic).
- Protection mots de passe compromis désactivée + Confirm email à activer (`SETUP.md`, advisor `auth_leaked_password_protection`).
- CORS `*` sur `psp` (TODO connu dans `supabase/functions/psp/index.ts`).
- Pas d'e-mail transactionnel (in-app seulement — `grep` resend/sendgrid/smtp = 0).
- Rate-limiting limité aux tentatives de pointage (5/10 min) ; autres RPC non limités. *(non vérifié : protection anti-abus applicative.)*
- Monitoring/alerting (Sentry…), a11y, i18n : **non vérifié**.

---

## Synthèse des actions prioritaires

**P0 (avant argent / avant d'ouvrir)**
1. Réconcilier le drift : `supabase db pull` (rapatrier `rls_private` + ratings + `verify-structure`), figer « toute modif = migration commitée ».
2. Fermer/valider `compute_mission_pricing` (fuite `pay_rules`).
3. Brancher + déployer + tester Stripe (volet 3), planifier la libération J+3.
4. Tests d'intégration : paiement, RLS inter-comptes, pointage QR/PIN.

**P1**
5. Perf RLS (`(select auth.uid())`), index FK, consolidation policies.
6. Déployer `process-spot-offers` (sinon la liste d'attente ne tourne pas).
7. Config auth prod (confirm email, leaked password), CORS `psp`, e-mails transactionnels.

**P2**
8. Monitoring, a11y, rate-limiting global, revue de charge Realtime.

---

_Relevé le 2026-07-20 sur `urosi` (prod). Les advisors et l'état des objets sont à re-vérifier après tout changement DDL et après le go-live Stripe._
