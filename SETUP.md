# UROSI-T — Branchement du backend Supabase

> Ce que ce depot contient : migrations SQL (schema, RLS, triggers), client
> Supabase type, auth, architecture front branchee dessus.
> Ce que **tu** executes (acces a ta prod Supabase) : appliquer les
> migrations, regler l'auth, poser les cles.

## 1. Appliquer les migrations

> Etat actuel : **toutes les migrations `0001` -> `0011` sont deja appliquees
> sur le projet Supabase de production (`urosit`)**, et l'Edge Function `psp`
> est deployee. Les etapes ci-dessous ne servent que pour recreer un
> environnement neuf.

**Option A — SQL Editor (le plus simple)**
Dashboard Supabase -> SQL Editor -> colle puis execute, dans l'ordre :
`supabase/migrations/0001_schema.sql` -> `0011_security_hardening.sql`
(l'ordre des numeros fait foi ; chaque fichier est re-executable).

**Option B — CLI**
```bash
npm i -g supabase
supabase link --project-ref <ton-project-ref>
supabase db push
```

(Optionnel, dev local uniquement) jeu de donnees de demo :
```bash
supabase db reset   # applique migrations + supabase/seed.sql
```
Ne jamais executer `seed.sql` sur un projet de production : il cree des
comptes `auth.users` avec un mot de passe connu (`demo-password`).

## 2. Configurer l'authentification (Dashboard -> Authentication)
- **Providers -> Email** : active.
- **Confirm email** : a activer pour la prod (en dev tu peux le couper pour
  tester vite).
- **URL Configuration -> Site URL** : `http://localhost:5173` en dev, ton
  domaine de prod ensuite.
- **Redirect URLs** : ajoute ton domaine de prod **et**
  `https://<ton-domaine>/reinitialisation` (cible du lien "mot de passe
  oublie" — sinon Supabase refuse la redirection).
- **Leaked password protection** (Authentication -> Policies) : a activer.
- **Telephone** : le numero est collecte a l'inscription et stocke dans
  `profiles.phone`. Pour l'auth par SMS (OTP), brancher un provider Twilio /
  MessageBird dans Authentication -> Providers -> Phone.

Le trigger `handle_new_user` (migration `0002_functions.sql`) cree
automatiquement la ligne `profiles` a chaque inscription, avec le `role`
passe dans les metadonnees (`worker` / `structure_admin`) via
`supabase.auth.signUp({ options: { data: { role } } })`.

## 3. Variables d'environnement
```bash
cp .env.example .env
```
Renseigne `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`
(Dashboard -> Project Settings -> API). Sur ta plateforme d'hebergement,
ajoute les deux `VITE_*` en variables d'environnement de build.

## 4. Lancer
```bash
npm install
npm run dev   # http://localhost:5173
npm test      # suite de tests Vitest
npm run build # typecheck + build de production
```

## 5. Tester le chemin critique
1. Cree un compte "Structure" et un compte "Travailleur" via l'ecran
   d'inscription de l'app.
2. Connecte en tant que structure : l'app te propose de creer ta structure,
   puis de publier une mission (titre, ville, date, duree <= 5h, taux net).
3. Connecte en tant que travailleur, tu dois voir la mission dans la liste
   des missions ouvertes ; clique "Postuler".
4. Reconnecte-toi en structure : la candidature apparait dans "Voir les
   candidatures" ; accepte-la.
5. Verifie le plafond legal : tente d'accepter une 4e journee consecutive
   chez la meme structure pour un travailleur non micro-entrepreneur ->
   l'insert/update doit etre bloque par le trigger
   `applications_consecutive_days_cap`.

## 6. Fonctionnalites branchees dans cette version
- **Remuneration intelligente** : regles `pay_rules` administrables dans le
  dashboard Structure (onglet Regles). Le moteur SQL
  `compute_mission_pricing` s'applique au trigger de publication et a
  l'apercu live du formulaire — jour de semaine, jours feries francais
  (calcul de Paques inclus), plage horaire, duree, secteur, difficulte,
  urgence, distance, tension offre/demande, bonus fixes.
- **Paiements + wallet** : a la completion d'une mission,
  `process_mission_payment` (idempotent) cree le paiement (remuneration +
  commission plateforme, cf. `platform_settings.commission_pct`), credite le
  wallet du travailleur et debite celui de la structure. Historique complet
  dans `payments` / `wallet_transactions`.
- **Edge Function `psp`** : abstraction du prestataire de paiement
  (provisionnement / retrait simules). Pour brancher Lemonway ou Stripe,
  suivre les commentaires dans `supabase/functions/psp/index.ts`.
- **Messagerie temps reel** : table `messages` (un fil par candidature
  acceptee), publiee sur `supabase_realtime` (RLS respectee).
- **Notifications** : table `notifications` + triggers (candidature,
  decision, completion, note, paiement, message, retard), temps reel.
- **Stats** : RPC `structure_stats`, `worker_stats`, `worker_cv`.
- **Recuperation de mot de passe** : page `/reinitialisation`.
- **Geolocalisation** : geocodage leger des communes MEL a la publication
  (`src/lib/geo.ts`), tri du flux par distance cote client (la position du
  travailleur ne quitte jamais son navigateur).

## Ce qui reste a brancher
- **PSP reel (Lemonway/Stripe)** : remplacer `simulateProvider` dans l'Edge
  Function `psp` et ne crediter le wallet qu'apres webhook de confirmation.
- **Auth SMS** : provider Twilio/MessageBird a configurer dans le dashboard.
- **Generation automatique des types** : `src/types/database.types.ts` est
  aligne manuellement sur les migrations. Des que le projet est lie en CLI,
  tu peux le regenerer via `supabase gen types typescript --linked`.

## Note d'architecture
Modele mandataire respecte dans le schema : aucune colonne ne permet a la
plateforme de fixer un prix ou de filtrer l'acces via l'indice. Plafond 5h =
contrainte `CHECK` sur `missions.duration_minutes`. Plafond 3 jours
consecutifs = trigger automatique sur `applications`. Contestabilite RGPD
Art. 22 = table `reliability_disputes`.
