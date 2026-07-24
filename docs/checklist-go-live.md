# Checklist go-live — « 1er utilisateur réel publie une mission et est payé »

> Synthèse des audits (`docs/audit-lancement.md`, `docs/audit-securite-complet.md`, `docs/stripe-*.md`).
> **Étiquettes** : 🔴 Bloquant (le parcours ne fonctionne pas sans) · 🟠 Important (à faire avant d'exposer de vrais utilisateurs) · 🟢 Facultatif (après).
> **Estimations** : jours-homme (j) pour **un dev** connaissant la stack. Le volet **juridique est externe** (non chiffré en dev). Estimations indicatives, pas un engagement.

---

## P0 — indispensable avant le 1er paiement réel

### Socle & cohérence
- [ ] 🔴 **Réconcilier le drift dépôt↔prod** — `supabase db pull` pour rapatrier le schéma `rls_private` + `can_rate_finished_application` + migrations `20260718091412/13`, et versionner l'edge function **`verify-structure`** (prod-only). Figer « toute modif = migration commitée ». *Sinon on ne peut pas déployer la migration Stripe de façon fiable.* — **0,5–1 j**
- [ ] 🟠 **Corriger `compute_mission_pricing`** (fuite des `pay_rules` d'autrui) — d'abord vérifier l'appelant, puis `revoke execute … from authenticated` **ou** garde `is_structure_owner`. — **0,5 j**
- [ ] 🔴 **Config Auth prod** (`SETUP.md`) — Confirm email, Redirect URLs (dont `/reinitialisation`), Leaked password protection. — **0,5 j**

### Chaîne argent Stripe (le gros morceau)
- [ ] 🔴 **Appliquer la migration Stripe** `20260719190000` en staging puis prod (`supabase db push`). — **0,25 j**
- [ ] 🔴 **Déployer les edge functions** `stripe-connect-onboard/-status/-login/-balance`, `stripe-create-payment`, `stripe-identity-start`, `stripe-webhook`, `release-due-payments` + **secrets** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) + endpoint webhook. — **1 j**
- [ ] 🔴 **UI travailleur — activer les versements** : bouton onboarding Express + **collecte IBAN** (hébergée Stripe) + affichage du statut/solde (`stripe-connect-balance`). — **2–3 j**
- [ ] 🔴 **UI structure — payer la mission** : PaymentIntent via **Stripe Elements** (SCA/3DS) au moment de l'engagement d'un candidat. — **2–3 j**
- [ ] 🔴 **Identité/KYC avant versement** : soit brancher **Stripe Identity**, soit décider que l'onboarding Express suffit pour le 1er paiement (à trancher). — **1–2 j** (0 j si Express seul)
- [ ] 🔴 **Planifier la libération J+3** — Supabase Scheduled Function **ou** activer `pg_cron` + `pg_net` pour appeler `release-due-payments` (aujourd'hui `pg_cron` **non activé**). — **0,5 j**
- [ ] 🔴 **Test bout en bout en mode test Stripe** : publier → payer → pointer (QR/PIN) → J+3 → Transfer → payout, vérifier `payments` (provider='stripe') et commission 18 %. — **1–2 j**
- [ ] 🔴 **Bascule clés live** après validation complète en test. — **0,25 j**

### Juridique / conformité (piste parallèle, externe)
- [ ] 🔴 **Cadre légal pour rémunérer des travailleurs** — statut (micro-entrepreneur `profiles.is_micro_entrepreneur`), SIRET structures, facturation/TVA, URSSAF, CGU/contrat. *On ne peut pas légalement verser un euro sans ce cadre.* — **externe (expert-comptable/juriste)**

**Sous-total P0 dev ≈ 10–15 j** (+ piste juridique en parallèle).

---

## P1 — avant d'ouvrir au-delà d'une poignée d'utilisateurs

- [ ] 🟠 **Tests d'intégration des flux sensibles** : paiement/J+3, **isolation RLS inter-comptes**, pointage **QR+PIN** (expiration, rejeu, verrouillage 5 échecs). — **3–5 j**
- [ ] 🟠 **Déployer `process-spot-offers`** si la liste d'attente est utilisée (sinon la redistribution ne tourne pas). — **0,5 j**
- [ ] 🟠 **E-mails transactionnels** (candidature acceptée, paiement, rappel) — aujourd'hui notifications in-app seulement. — **1–2 j**
- [ ] 🟠 **Perf RLS** : `auth.uid()` → `(select auth.uid())` sur les 30 policies signalées. — **0,5–1 j**
- [ ] 🟠 **Durcissement** : CORS `psp` restreint à `urosi.fr`/`app.urosi.fr` ; vérifier les policies Storage des buckets `kyc-documents`/`attendance-evidence`. — **0,5 j**
- [ ] 🟠 **Gestion des cas argent** : remboursement/annulation, litiges (`charge.dispute.created`), soldes négatifs, réconciliation. — **2–3 j**

**Sous-total P1 ≈ 8–12 j.**

---

## P2 — qualité, échelle, finitions

- [ ] 🟢 **Index FK manquants** (32) + consolidation des **policies permissives** (36). — **1 j**
- [ ] 🟢 **Monitoring/alerting** (Sentry ou équivalent) + logs edge functions. — **1 j**
- [ ] 🟢 **Tri/pagination serveur du flux** (aujourd'hui tri distance côté client). — **1 j**
- [ ] 🟢 **Revue de charge Realtime** (missions) + plan Supabase adapté. — **0,5 j** *(non chiffrable sans mesure)*
- [ ] 🟢 **Rate-limiting global** des RPC (au-delà du pointage). — **1 j**
- [ ] 🟢 **Accessibilité (a11y), états vides/erreur, i18n**. — **continu**
- [ ] 🟢 **Features démo→réel** : galerie « Photos du lieu » et réglage « Tout partager » du CV — porter ou retirer de la démo. — **1–2 j**

**Sous-total P2 ≈ 6–8 j.**

---

## Chemin critique minimal (1 mission payée, bout en bout)

1. Réconcilier le drift → 2. Migration Stripe en prod → 3. Déployer edge functions + secrets + webhook → 4. UI onboarding travailleur (IBAN) → 5. UI paiement structure → 6. Planifier J+3 → 7. Test complet en mode test → 8. Config auth prod → 9. Cadre juridique (parallèle) → 10. Bascule live.

**Estimation chemin critique : ~2 à 3 semaines de dev** pour un développeur, **hors juridique** (à lancer en parallèle dès maintenant, souvent le vrai goulot d'étranglement).

_Basé sur les audits du 2026-07-20. Estimations à réviser après la 1re passe Stripe en staging._
