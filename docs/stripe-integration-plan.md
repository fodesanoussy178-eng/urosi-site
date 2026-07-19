# Plan d'intégration Stripe — UROSI

> Produits ciblés : **Connect** (paiements marketplace), **Identity** (vérification KYC des travailleurs), **Radar** (lutte anti-fraude sur les paiements des structures).
> Généré à partir de l'architecture réelle du dépôt (Supabase + Edge Functions). Toutes les étapes se font **en mode test** avant le go-live.

## 1. Modèle économique → correspondance Stripe

D'après `src/features/pricing/priceSplit.ts` et la migration `0009_wallet_payments.sql` :

- La **structure** (entreprise/association) paie `totalStructureCents = brut + commission` (commission plateforme configurable, aujourd'hui **18 %** — `platform_settings.commission_pct`).
- Le **travailleur** reçoit `netWorkerCents = brut` (rémunération non amputée en V1).
- **UROSI** conserve la commission.
- Le paiement est retenu puis libéré à **J+3** (`applications.payment_ready_at`, Edge Function `release-due-payments`).
- Les montants sont déjà en **centimes / EUR** = unités mineures Stripe. ✅

| Rôle UROSI | Objet Stripe |
|---|---|
| Travailleur (reçoit l'argent) | **Compte connecté Express** |
| Structure (paie) | **Customer** + PaymentIntent (pas de compte Connect nécessaire) |
| Commission UROSI | `application_fee` / solde plateforme conservé |
| Retenue J+3 | Charge encaissée d'abord, **Transfer** au travailleur à J+3 |

### Modèle de charge retenu : **charges et transferts séparés**

La structure paie tout de suite, mais le travailleur n'est confirmé et payé qu'à J+3 → on **encaisse d'abord sur la plateforme**, puis on **transfère** au travailleur au moment de la libération. C'est exactement le point d'ancrage déjà présent dans `release-due-payments`.

```
1. Structure paie  → PaymentIntent (totalStructureCents), fonds sur la plateforme
                     transfer_group = "mission_<id>", metadata { mission_id, structure_id, worker_id }
                     Radar actif · SCA/3DS EU via automatic_payment_methods
2. Retenue         → jusqu'à applications.payment_ready_at (J+3)
3. Libération J+3  → Transfer(netWorkerCents) vers le compte Express du travailleur
                     la plateforme conserve la commission
                     écriture au grand livre wallet avec provider='stripe'
4. Versement       → Stripe verse sur le compte bancaire du travailleur (kind='withdrawal')
```

## 2. Les coutures déjà présentes dans le code

Le dépôt a été conçu pour brancher un PSP plus tard. On **câble Stripe dans l'existant**, on ne réinvente rien :

- `supabase/functions/psp/index.ts` — stub qui renvoie `503`. Point d'entrée du code serveur Stripe.
- `supabase/functions/release-due-payments/index.ts` — sélectionne déjà les candidatures `payment_pending` échues et appelle `release_payment_ready_mission` en `service_role`. C'est là que se déclenchera le **Transfer** Stripe.
- `private.guard_simulated_payment` — bloque `provider='internal'` hors staging → à faire accepter `provider='stripe'`.
- `process_mission_payment` (security definer, idempotent) — écriture centralisée au grand livre ; aucun client n'écrit directement dans `wallets`/`wallet_transactions`/`payments`. On garde ce principe : les Edge Functions Stripe appellent des RPC `security definer`.
- Tables KYC déjà là (`0016_kyc_siret_verification`, `harden_worker_kyc`, `kyc_access_log`) + panneau de revue KYC Fondateur → alimenté par Stripe Identity.

## 3. Où vit le code

**Tout appel avec la clé secrète Stripe est côté serveur (Supabase Edge Functions, Deno).**

| Edge Function | Rôle |
|---|---|
| `stripe-connect-onboard` | Crée/rafraîchit un compte Express travailleur + Account Link, stocke `stripe_account_id`. |
| `stripe-create-payment` | Paiement d'une mission par la structure → PaymentIntent (montant, transfer_group, metadata), renvoie `client_secret`. Radar par défaut. |
| `stripe-identity-start` | Crée une `VerificationSession` pour un travailleur. |
| `stripe-webhook` | **Vérifie la signature**, idempotent par `event.id`, traite `payment_intent.succeeded`, `account.updated`, `identity.verification_session.verified`, `transfer.*`, `payout.*`, `charge.dispute.created`. |
| `release-due-payments` (existant) | À J+3 : crée les **Transfers** au lieu de l'appel interne. |

**Frontend** : uniquement la clé **publishable** (`VITE_STRIPE_PUBLISHABLE_KEY`) + Stripe.js/Elements pour la carte de la structure et le SCA. Nécessitera `@stripe/stripe-js` (non encore installé).

## 4. Secrets — jamais dans le dépôt ni dans le chat

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` → `supabase secrets set …` (jamais commités).
- Commencer avec des clés **test** (`sk_test_…`, `pk_test_…`).
- Seule la clé **publishable** (non sensible) va dans le frontend.
- Le webhook **doit** vérifier la signature ; toutes les créations utilisent une **clé d'idempotence**.

## 5. Connect — comptes Express (travailleurs)

- Type **Express** : onboarding + tableau de bord hébergés par Stripe, conformité des versements gérée par Stripe. Idéal pour des travailleurs individuels en France/UE.
- Flux : `stripe-connect-onboard` crée le compte (`country=FR`, `capabilities: transfers`), stocke `stripe_account_id` sur le profil, renvoie une **Account Link** ; on bloque tout versement tant que `charges_enabled`/`payouts_enabled` ne sont pas vrais (mis à jour via le webhook `account.updated`).
- Annulations/remboursements : le travailleur annule → pas de Transfer ; la structure annule avant la mission → remboursement du PaymentIntent.

## 6. Identity — KYC travailleur

- Bloquer le **premier versement** d'un travailleur sur une vérification réussie.
- L'onboarding Express collecte déjà un KYC de base ; ajouter **Stripe Identity** (document + selfie) pour un niveau supérieur.
- `identity.verification_session.verified` alimente le panneau de revue KYC existant (statut `verified` au lieu d'une saisie manuelle).
- Garder la validation **SIRET** française pour les structures (`src/features/structure/verification.ts`).

## 7. Radar — anti-fraude

- S'applique aux PaymentIntents structure→plateforme.
- Attacher `metadata` (mission_id, structure_id, worker_id) → règles Radar exploitables.
- Optionnel : conditionner la libération au `risk_score`.
- Gérer `charge.dispute.created` (litiges/chargebacks).

## 8. Séquencement (phases)

1. **Fondations** : compte Stripe, clés test en secrets Supabase, SDK Stripe dans les Edge Functions, endpoint webhook + vérification de signature, table d'idempotence, colonnes Stripe (migration). Faire accepter `provider='stripe'` à `guard_simulated_payment` en staging.
2. **Onboarding Connect** travailleur (Express + Account Link), stockage de l'`account_id`, blocage versement tant que non activé.
3. **Identity KYC** travailleur, libération conditionnée à `verified`.
4. **Paiement structure** (PaymentIntent + Elements + SCA) avec **Radar** ; retenue via `transfer_group`.
5. **Libération J+3** → **Transfers** + commission + versements ; grand livre `provider='stripe'`.
6. **Cas limites** : remboursements, litiges, annulations, soldes négatifs, réconciliation. Go-live : restreindre le CORS (`psp` a aujourd'hui `Access-Control-Allow-Origin: *` — déjà un TODO à corriger), bascule en clés **live**, activation des règles Radar.

## 9. Revue de l'existant

- ✅ `psp` : CORS `*` à restreindre à `https://urosi.fr` / `https://app.urosi.fr` avant tout effet de bord (déjà noté dans le code).
- ✅ Libération déjà réservée au `service_role` — garder les handlers webhook **idempotents** (stocker les `event.id` traités).
- ✅ `splitPrice` : commission ajoutée au coût structure (paie 118 %, travailleur 100 %). Stripe : charge = `totalStructureCents`, Transfer = `netWorkerCents`, plateforme conserve la commission.
- ✅ Montants déjà en centimes/EUR — cohérent avec Stripe.
- ⚠️ SCA/3DS obligatoire (UE) → `automatic_payment_methods`.

## 10. Migration de schéma à prévoir (phase 1)

Sur `public.profiles` (travailleurs) :
`stripe_account_id text`, `stripe_charges_enabled boolean`, `stripe_payouts_enabled boolean`, `stripe_identity_status text`.

Nouvelle table d'idempotence webhook : `public.stripe_webhook_events (id text primary key, type text, received_at timestamptz default now())`.

RPC `security definer` (appelées par les Edge Functions en `service_role`, conformément au principe « aucune écriture client directe ») :
`set_worker_stripe_account(...)`, `set_worker_stripe_status(...)`, et l'extension de `process_mission_payment` / `release_payment_ready_mission` pour `provider='stripe'` avec référence au PaymentIntent/Transfer.

---

### Comment obtenir le plugin/MCP Stripe officiel plus tard

Le plugin `stripe@claude-plugins-official` et le serveur MCP `https://mcp.stripe.com` nécessitent une authentification OAuth interactive (navigateur) impossible depuis une session Claude Code **web/distante**. Lancer les étapes d'installation depuis **Claude Code sur ta machine locale** pour obtenir l'outil `stripe_implementation_planner`.
