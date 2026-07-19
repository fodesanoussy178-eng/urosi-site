# Déploiement de l'intégration Stripe — MODE TEST

> Cette intégration est livrée **en mode test uniquement**. Aucun secret n'est
> dans le dépôt. Rien n'est déployé automatiquement : suis les étapes ci-dessous
> quand tu es prêt. Ne passe en clés **live** qu'après validation bout-en-bout.

## 0. Prérequis

- Un compte Stripe (Dashboard en mode **Test**).
- Activer les produits : **Connect** (Express), **Identity**, **Radar**.
- Le CLI Supabase installé et lié au projet (`supabase link`).

## 1. Migration de base de données

```bash
supabase db push        # applique 20260719190000_stripe_integration_foundations.sql
```

Ajoute : colonnes Connect/Identity sur `profiles`, `stripe_customer_id` sur
`structures`, références Stripe sur `payments`/`applications`, table
`stripe_webhook_events`, et les RPC backend (`record_stripe_mission_payment`, …).

Régénère ensuite les types TypeScript (facultatif, pour typer les nouvelles
colonnes côté front) :

```bash
supabase gen types typescript --linked > src/types/database.types.ts
```

## 2. Secrets des Edge Functions (JAMAIS commités)

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx   # obtenu à l'étape 4
# APP_URL sert aux redirections d'onboarding (défaut https://app.urosi.fr)
supabase secrets set APP_URL=https://app.urosi.fr
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont injectés
automatiquement par la plateforme.

## 3. Déploiement des fonctions

```bash
supabase functions deploy stripe-connect-onboard
supabase functions deploy stripe-connect-status
supabase functions deploy stripe-connect-login
supabase functions deploy stripe-connect-balance
supabase functions deploy stripe-create-payment
supabase functions deploy stripe-identity-start
supabase functions deploy release-due-payments
# Le webhook ne doit PAS vérifier le JWT (appelé par Stripe) :
supabase functions deploy stripe-webhook --no-verify-jwt
```

### IBAN et versements automatiques (Express)

- L'**IBAN** est collecté pendant l'onboarding hébergé Stripe (le compte est
  créé en `country=FR`, `default_currency=eur`, et l'Account Link force la
  collecte de tous les champs requis, IBAN inclus). Aucun champ IBAN maison à
  construire.
- Les **versements sont automatiques** : le compte Express est configuré en
  payout `daily`. Dès qu'un Transfer arrive (libération J+3), Stripe reverse le
  solde vers l'IBAN du travailleur sans action manuelle.
- `stripe-connect-login` fournit un lien vers le **tableau de bord Express** où
  le travailleur peut consulter ses versements et **mettre à jour son IBAN**.

## 4. Endpoint webhook Stripe

Dashboard Stripe → Developers → Webhooks → Add endpoint :

- URL : `https://<projet>.functions.supabase.co/stripe-webhook`
- Événements : `account.updated`, `payment_intent.succeeded`,
  `payment_intent.payment_failed`, `charge.dispute.created`,
  `identity.verification_session.verified`,
  `identity.verification_session.processing`,
  `identity.verification_session.requires_input`,
  `identity.verification_session.canceled`.

Copie le **Signing secret** (`whsec_…`) dans `STRIPE_WEBHOOK_SECRET` (étape 2),
puis redéploie `stripe-webhook`.

## 5. Frontend

```
# .env.local
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
```

Le service `src/features/payments/stripeService.ts` expose :
`startConnectOnboarding`, `refreshConnectStatus`, `fetchStripeBalance`,
`createMissionPayment`, `startIdentityVerification`, `getStripe`.

## 6. Planifier la libération J+3

`release-due-payments` doit être appelée régulièrement avec l'en-tête
`Authorization: Bearer <service_role>` (jamais exposée côté client). Options :
Supabase Scheduled Functions, ou `pg_cron` + `pg_net`. Elle crée les Transfers
Stripe pour les candidatures `payment_pending` échues dont le travailleur est
onboardé, versements activés et identité vérifiée.

## 7. Tester en mode test

- Cartes de test : `4242 4242 4242 4242` (succès), `4000 0027 6000 3184` (3DS),
  `4000 0000 0000 9995` (refus).
- Connect Express : utiliser les valeurs de test proposées par l'onboarding.
- Identity : documents de test Stripe.
- Vérifier dans le Dashboard : PaymentIntent → Transfer → Payout, et les
  entrées `payments` (provider='stripe') côté Supabase.

## Flux de bout en bout

1. **Travailleur** → `stripe-connect-onboard` (Express) → `account.updated`
   met à jour `charges_enabled`/`payouts_enabled`.
2. **Travailleur** → `stripe-identity-start` → webhook `verified` →
   `stripe_identity_status='verified'`.
3. **Structure** → `stripe-create-payment` → PaymentIntent (Radar + SCA) →
   `payment_intent.succeeded` rattache la charge à la candidature.
4. Mission réalisée (pointage QR/PIN) → candidature `payment_pending`,
   `payment_ready_at = now + 3 jours`.
5. **J+3** → `release-due-payments` → **Transfer** au travailleur →
   `record_stripe_mission_payment` (provider='stripe', passage `completed`).
6. Stripe **verse** (payout) sur le compte bancaire du travailleur ; le solde
   affiché vient de `stripe-connect-balance`.

## Notes de réconciliation (avant go-live)

- Avec Connect, l'argent réel du travailleur vit dans **Stripe**, pas dans le
  wallet interne (qui était la simulation d'avant-PSP). Basculer l'affichage du
  solde travailleur sur `fetchStripeBalance()` ; le retrait interne
  (`withdraw_wallet`) est remplacé par les **payouts** Stripe.
- `payments` (provider='stripe') reste l'enregistrement de référence pour
  l'audit et la comptabilité.
- Reste à traiter avant le live : remboursements/annulations, litiges
  (`charge.dispute.created`), soldes négatifs, bascule des clés **live**,
  activation des règles Radar, restriction CORS déjà en place dans `_shared`.
