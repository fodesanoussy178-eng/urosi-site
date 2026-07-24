# Audit de préparation au lancement — UROSI

> Méthode : lecture du code du dépôt + **advisors Supabase de production** (projet `urosi`, read-only) + état des migrations distantes.
> **Non couvert** : test fonctionnel de bout en bout sur la vraie base, revue juridique/comptable, test d'intrusion. Ces points nécessitent une intervention dédiée.

## Verdict global

Le **backend est étonnamment mûr** : 88 policies RLS, 129 fonctions `security definer`, gating `service_role`, journal d'accès KYC, gardes de cycle de vie (missions/candidatures immuables). Ce n'est pas un prototype fragile.

**Mais** il reste des **bloquants réels** avant d'encaisser/payer pour de vrai, et de la dette de sécurité/perf à traiter. « Il ne manque que quelques détails » est vrai pour l'**UI**, faux pour la **mise en production**.

---

## 🔴 Bloquants (avant tout lancement manipulant de l'argent réel)

1. **Chaîne argent non active.** `supabase/functions/psp` = stub `503`, `guard_simulated_payment` bloque les paiements internes, libération J+3 non planifiée. La brique **Stripe** (mergée) n'est **ni branchée à l'UI, ni activée, ni testée**. → Aucun euro ne circule.

2. **KYC / identité manuelle.** Validation par le fondateur (`VITE_KYC_MODE=simulation`). Stripe Identity présent en plomberie, non branché. → Pas de vérification automatique avant versement.

3. **Drift de migrations (source de vérité cassée).** La prod contient deux migrations **absentes du dépôt** :
   - `20260718091412 enable_bidirectional_ratings_after_attendance`
   - `20260718091413 secure_rating_authorization_helper`

   Elles ont été appliquées directement en prod (SQL Editor) sans être commitées, alors que `SETUP.md` déclare les migrations « source de vérité ». Conséquence : **le dépôt ne reproduit plus la prod**, et du SQL dont dépend le front (notation bidirectionnelle) n'est ni versionné ni revu. À l'inverse, `20260719190000_stripe_integration_foundations` (dépôt) n'est **pas** en prod (attendu, mode test).
   → **Action** : exporter les 2 migrations prod dans `supabase/migrations/` (via `supabase db pull` ou export manuel) puis figer le process « toute modif passe par une migration commitée ».

4. **Configuration Auth de prod à finaliser** (cf. `SETUP.md`) : activer **Confirm email**, **Leaked password protection** (voir advisor ci-dessous), et les **Redirect URLs** (dont `/reinitialisation`).

---

## 🟠 Sécurité — advisors Supabase (prod), 53 findings

- **51 × `authenticated_security_definer_function_executable` (WARN).** 51 fonctions `SECURITY DEFINER` sont appelables par le rôle `authenticated` via `/rest/v1/rpc/...`. Beaucoup sont **légitimes** (RPC applicatives avec contrôle `auth.uid()` interne), mais certaines sont des **helpers internes** qui ne devraient pas être exposés (ex. `compute_mission_pricing`, `can_access_application`).
  → **Action** : passer les 51 en revue ; pour chaque helper interne, `revoke execute ... from authenticated` (ou `security invoker`) ; pour les RPC légitimes, **confirmer** la présence d'un contrôle d'autorisation interne. C'est la principale surface d'attaque applicative.
- **1 × `rls_enabled_no_policy` (INFO)** : `public.mission_qr_tokens` a la RLS activée sans policy → accès nul via l'API (deny implicite). OK si intentionnel, **à confirmer**.
- **1 × `auth_leaked_password_protection` (WARN)** : protection HaveIBeenPwned désactivée → à activer.

Remédiation : https://supabase.com/docs/guides/database/database-linter

## 🟠 Performance / dette — advisors Supabase (prod), 150 findings

- **30 × `auth_rls_initplan` (WARN)** : policies utilisant `auth.uid()` directement → réévalué par ligne. Remplacer par `(select auth.uid())`.
- **36 × `multiple_permissive_policies` (WARN)** : plusieurs policies permissives sur une même table/rôle/action → surcoût. À consolider.
- **32 × `unindexed_foreign_keys` (INFO)** : FK sans index → jointures/suppressions lentes à l'échelle.
- **52 × `unused_index` (INFO)** : normal sur une base encore peu remplie.
  → Pas bloquant à faible volume, mais à traiter **avant montée en charge**.

## 🟠 Couverture de tests

12 fichiers de test, concentrés sur : pricing/commission, inscription/auth, stats, `format`/`geo`/`slots`, démo.
**Non couverts** par des tests automatisés — et ce sont les flux les plus sensibles :
- **Pointage QR + PIN** et machine à états de présence.
- **Libération de paiement** / process de paiement.
- **Policies RLS** (aucun test d'isolation inter-comptes).
- **Flux wallet** (dépôt/retrait/soldes).
→ **Action** : tests d'intégration ciblés sur argent + présence + isolation RLS avant d'ouvrir aux vrais utilisateurs.

## 🟠 Produit / Ops

- **Notifications in-app uniquement** (table `notifications`) — **pas d'e-mail transactionnel** (Resend/SendGrid/…) pour candidature acceptée, paiement, rappel de mission. À décider (impact rétention/confiance).
- **CORS `*` sur l'edge `psp`** (TODO connu, audit L3) — à restreindre à `urosi.fr`/`app.urosi.fr` avant d'activer tout effet de bord. (Les nouvelles fonctions Stripe ont déjà un CORS restreint.)
- **États d'erreur/vides, accessibilité (a11y), i18n, monitoring/alerting (Sentry…)** : non audités — à vérifier.

## 🟠 Conformité (hors de ma compétence — validation par un professionnel requise)

Un service qui **rémunère des travailleurs** implique un cadre légal/comptable : statut **micro-entrepreneur** (`profiles.is_micro_entrepreneur`), **SIRET** structures, commission 18%, **facturation/TVA**, déclarations **URSSAF**, contrat/CGU. Les pages **CGU** et **confidentialité** existent (statiques). → Faire valider par un expert-comptable/juriste **avant** d'encaisser.

---

## Plan d'action priorisé

**P0 — avant de manipuler de l'argent réel**
1. Réconcilier le drift de migrations (rapatrier les 2 migrations prod dans le dépôt) et figer le process.
2. Brancher + **tester** Stripe en mode test (onboarding Express + IBAN, Identity, PaymentIntent, webhook, payout J+3), puis basculer en clés live.
3. Finaliser la config Auth prod (confirm email, leaked password, redirect URLs).
4. Auditer les 51 fonctions `SECURITY DEFINER` exposées (revoke ou confirmer l'authz).

**P1 — avant d'ouvrir aux vrais utilisateurs**
5. Tests d'intégration : paiement, pointage QR/PIN, isolation RLS, wallet.
6. E-mails transactionnels.
7. Restreindre le CORS de `psp` ; perf RLS (`(select auth.uid())`).

**P2 — avant la montée en charge**
8. Index FK manquants, consolidation des policies permissives.
9. Monitoring/alerting, a11y, états d'erreur/vides.
10. Validation juridique/comptable.

---

_Advisors relevés le 2026-07-20 sur le projet Supabase `urosi` (prod). À réexécuter après chaque changement DDL._
