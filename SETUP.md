# UROSI — Branchement du backend Supabase

> Ce que ce depot contient : migrations SQL (schema, RLS, triggers), client
> Supabase type, auth, architecture front branchee dessus.
> Ce que **tu** executes (acces a ta prod Supabase) : appliquer les
> migrations, regler l'auth, poser les cles.

## 1. Appliquer les migrations

> Les migrations du dossier sont la source de verite. Verifie toujours la
> migration distante avec `supabase migration list` avant un `db push`.
> Le seul chemin de deploiement est `supabase/migrations/` applique dans
> l'ordre lexicographique (CLI ou SQL Editor). Ne jamais regenerer ni
> utiliser un fichier concatene type `apply_all.sql` : un tel fichier
> derive inevitablement des migrations et produit un schema incomplet
> (celui du depot s'arretait a 0006 et a ete supprime le 16/07/2026).
> La migration KYC ne doit d'abord etre appliquee que sur un environnement
> local ou une branche Supabase de test, jamais directement en production.

**Option A — SQL Editor (le plus simple)**
Dashboard Supabase -> SQL Editor -> colle puis execute, dans l'ordre :
les fichiers de `supabase/migrations/` dans l'ordre lexicographique.

**Option B — CLI**
```bash
npm i -g supabase
supabase link --project-ref <ton-project-ref>
supabase db push --dry-run
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
Renseigne `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` et `VITE_KYC_MODE`
(Dashboard -> Project Settings -> API). Sur ta plateforme d'hebergement,
ajoute ces trois `VITE_*` en variables d'environnement de build.

- `VITE_KYC_MODE=simulation` : la revue manuelle est disponible pour les
  comptes presents dans `founder_access` via `/fondateur?section=kyc`.
- `VITE_KYC_MODE=external` : les boutons de decision manuelle sont masques ;
  un futur webhook serveur du prestataire devra appeler la transition KYC.

Ne mets jamais une cle `service_role`, un secret de paiement ou une cle privee
dans une variable `VITE_*` : elles sont integrees au JavaScript public.

### Centre Fondateur et laboratoire

Le centre unique est servi sur `/fondateur`. Toutes ses mutations passent
par des fonctions SQL `SECURITY DEFINER` qui reverifient le role Fondateur,
et chaque action est ajoutee a `founder_admin_log`. Les notes et avis ne sont
exposes par aucune RPC de modification.

Le laboratoire est desactive par defaut et ne doit jamais etre active sur la
base de production. Sur un projet Supabase de staging separe, executer apres
les migrations :

```sql
update private.founder_settings
set environment = 'staging', lab_enabled = true, updated_at = now()
where singleton;
```

Pour rendre le niveau MFA AAL2 obligatoire sur toutes les actions Fondateur,
activer ensuite, uniquement apres avoir configure le second facteur du compte :

```sql
update private.founder_settings
set require_mfa = true, updated_at = now()
where singleton;
```

Le laboratoire ecrit seulement dans `founder_lab_scenarios` : il ne cree pas
de comptes Auth, de missions, de KYC ni de paiements dans les tables reelles.

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
   puis de publier une mission (titre, ville, date, duree de 1 h a 3 jours,
   remuneration choisie par la structure).
3. Connecte en tant que travailleur, tu dois voir la mission dans la liste
   des missions ouvertes ; clique "Postuler".
4. Reconnecte-toi en structure : la candidature apparait dans "Voir les
   candidatures" ; accepte-la.
5. Verifie le plafond legal : tente d'accepter une 4e journee consecutive
   chez la meme structure pour un travailleur non micro-entrepreneur ->
   l'insert/update doit etre bloque par le trigger
   `applications_consecutive_days_cap`.
6. Apres acceptation, verifie que le travailleur passe en KYC `requested`,
   qu'il peut envoyer un PDF/JPG/PNG/WebP de 10 Mo maximum, puis qu'un compte
   fondateur peut verifier ou refuser le dossier dans `/fondateur/kyc`.
7. Tant que le statut n'est pas `verified`, un retrait wallet doit etre
   impossible. Les RPC historiques `deposit_wallet` et `withdraw_wallet` ne
   sont executables par aucun compte client, meme apres verification KYC.

## 6. Fonctionnalites branchees dans cette version
- **Remuneration intelligente** : regles `pay_rules` administrables dans le
  dashboard Structure (onglet Regles). Le moteur SQL
  `compute_mission_pricing` s'applique au trigger de publication et a
  l'apercu live du formulaire — jour de semaine, jours feries francais
  (calcul de Paques inclus), plage horaire, duree, secteur, difficulte,
  urgence, distance, tension offre/demande, bonus fixes.
- **Paiements + wallet** : `process_mission_payment` reste idempotent et
  reserve au backend. En production, un trigger refuse le provider interne :
  aucun paiement, revenu ou credit wallet simule n'est cree. Les mouvements
  distinguent `pending`, `available` et `blocked`; seul `available` alimente
  le solde affichable.
- **Edge Function `psp`** : point d'entree inactif qui renvoie `503` jusqu'au
  branchement d'un vrai prestataire. Le futur webhook devra verifier la
  signature du PSP, garantir l'idempotence et confirmer le mouvement avant de
  rendre les fonds disponibles.
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
- **Service de paiement reel** : integrer un PSP cote serveur et ne crediter
  le wallet qu'apres une confirmation externe signee et verifiee. Ne jamais
  exposer sa cle secrete dans une variable `VITE_*`.
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
