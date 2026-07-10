# Urosi-t

Plateforme de micro-missions de la MEL (modele mandataire). Application
React + TypeScript branchee sur une vraie base Supabase (Postgres + Auth +
Row Level Security) — plus un prototype a donnees fictives.

## Stack

- **React 18 + TypeScript** (Vite)
- **react-router-dom** pour le routing et les vues protegees par role
- **Supabase** : Postgres, Auth, Row Level Security. Aucune donnee mockee :
  tout passe par les tables `profiles`, `structures`, `missions`,
  `applications` definies dans `supabase/migrations/`.
- **Vitest + Testing Library** pour les tests

## Architecture

```
src/
  app/                 assemblage des pages (layout, routing par role)
  components/ui/       primitives visuelles (Button, TextField, theme...)
  features/
    auth/              formulaire, service Supabase Auth, contexte de session
    missions/          liste des missions, candidatures (cote travailleur)
    structure/          creation de mission, gestion des candidatures (cote structure)
    profile/           edition du profil
  lib/                 client Supabase, formatage, config env
  types/               types generes/alignes sur le schema Supabase
supabase/
  migrations/          schema SQL, RLS, triggers (source de verite du backend)
  seed.sql             jeu de donnees de demo, dev local uniquement
```

Le design visuel (theme sombre, cartes, badges) est centralise dans
`src/components/ui/theme.ts` et reste identique au prototype d'origine.

## Demarrage

```bash
npm install
cp .env.example .env   # renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
npm run dev            # http://localhost:5173
```

Voir [`SETUP.md`](./SETUP.md) pour le branchement complet du backend
Supabase (migrations, auth, variables d'environnement).

## Scripts

| Commande | Description |
| --- | --- |
| `npm run dev` | serveur de developpement |
| `npm run build` | typecheck + build de production |
| `npm run typecheck` | verification TypeScript seule |
| `npm run lint` | ESLint |
| `npm test` | tests Vitest |
| `npm run preview` | previsualise le build de production |

## Fonctionnalites

- Auth email persistante (inscription Worker/Structure, connexion, mot de
  passe oublie via `/reinitialisation`).
- Publication et gestion de missions (secteur, difficulte, urgence, heure,
  geolocalisation MEL) et candidatures avec pointage QR.
- **Remuneration intelligente** : regles configurables par la structure
  (week-end, jours feries, nuit, duree, secteur, difficulte, urgence,
  distance, tension offre/demande, bonus). Calcul en SQL, apercu live a la
  publication, detail transparent affiche au travailleur.
- **Paiements + wallet** : paiement automatique a la completion (commission
  plateforme incluse), wallets credite/debite, historique complet, Edge
  Function `psp` prete pour Lemonway/Stripe.
- **Messagerie temps reel** par mission (Supabase Realtime) et
  **notifications** en direct (candidatures, decisions, paiements, notes,
  retards, messages).
- **CV vivant** (missions prouvees + notes bidirectionnelles), statistiques
  Worker et Structure, wallet, abonnement structure.

## Modele metier (mandataire)

- Une structure publie des missions (`missions`), plafonnees a **5h** par
  mission (contrainte `CHECK` en base, pas contournable cote client).
- Un travailleur postule (`applications`). Un trigger Postgres bloque
  l'acceptation d'une **4e journee consecutive** chez la meme structure pour
  les travailleurs non micro-entrepreneurs.
- L'indice de fiabilite (`reliability_index`) est calcule en base et n'est
  jamais utilise pour filtrer l'acces aux missions.

Voir `supabase/migrations/0001_schema.sql` (schema), `0002_functions.sql`
(triggers/fonctions) et `0003_rls.sql` (policies) pour le detail.

## Hors perimetre (roadmap)

- PSP reel : l'Edge Function `psp` simule le provisionnement/retrait ;
  brancher Lemonway ou Stripe en suivant ses commentaires (webhook de
  confirmation avant credit du wallet).
- Auth par SMS (OTP) : necessite un provider (Twilio/MessageBird) configure
  dans le dashboard Supabase. Le telephone est deja collecte sur le profil.
- Back-office admin.
