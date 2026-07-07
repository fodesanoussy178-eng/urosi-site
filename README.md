# UROSI

Application React/Vite connectee a Supabase pour `urosi.fr`.

## Ce qui est pret

- Authentification Supabase par email et mot de passe.
- Inscription worker avec prenom, nom, date de naissance, adresse et telephone.
- Inscription structure avec email, telephone, SIRET/SIREN et statut de verification.
- Publication d'une vraie mission par une structure.
- Apparition des missions publiees cote worker.
- Candidature worker sur une mission.
- Suivi des candidatures cote structure.
- Notes par etoiles et signalement en fin de mission.
- Migration SQL avec les tables demandees et RLS activee.
- Edge Function `verify-structure` pour brancher l'API Sirene / Annuaire Entreprises cote serveur.

## Installation

```bash
pnpm install
cp .env.example .env.local
pnpm run dev
```

Le projet contient deja `.env.production` avec les valeurs publiques Supabase
necessaires au deploiement Vercel. Pour le developpement local, tu peux aussi
creer `.env.local` :

```bash
VITE_SUPABASE_URL=https://TON-PROJET.supabase.co
VITE_SUPABASE_ANON_KEY=ta-cle-anon-publique
```

Ne jamais mettre la cle `service_role` dans l'app React ou dans GitHub.

## Mise en ligne sur urosi.fr

1. Creer un projet sur Supabase.
2. Copier l'URL du projet et la cle `anon public`.
3. Vercel peut utiliser `.env.production` directement. Les variables Vercel
   peuvent aussi etre renseignees dans le dashboard si tu veux les surcharger.
4. Lancer la migration SQL.
5. Deployer l'Edge Function `verify-structure`.
6. Publier le site React/Vite sur le domaine `urosi.fr`.

Variables Vercel :

```bash
VITE_SUPABASE_URL=https://nksxwbkpazcyoumcwzll.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_rEaF-qUpBDDQEeYxdTrgBQ_5s77Lwty
```

Build command :

```bash
pnpm run build
```

Le dossier de sortie est :

```bash
dist
```

Important : ce projet est une app React/Vite. Il ne faut pas ouvrir le fichier
`index.html` source par double-clic. En local, utiliser `pnpm run dev`. Sur
Vercel, utiliser les reglages ci-dessus.

## Base de donnees

Appliquer la migration :

```bash
supabase link --project-ref TON_PROJECT_REF
supabase db push
```

ou copier le SQL de `supabase/migrations/202607070001_urosi_core.sql` dans l'editeur SQL Supabase.

## Verification structure

La verification SIRET/SIREN doit se faire cote serveur, via l'Edge Function :

```bash
supabase functions deploy verify-structure
```

Configurer ensuite les secrets necessaires selon l'API choisie :

```bash
supabase secrets set ENTREPRISES_API_TOKEN=...
```

L'app met le statut structure en `pending` tant que l'appel API n'est pas configure.
