# UROSI Phase 0 : le parcours en 5 comportements

La Phase 0 d'UROSI tient en trois verbes : **trouver → participer → prouver**.
Toute l'interface participant se résume à cinq comportements. Une
fonctionnalité qui n'est indispensable à aucun d'eux n'apparaît pas dans
l'interface Phase 0.

| # | Comportement | Écran | Données |
|---|---|---|---|
| 1 | Je vois une mission | `/missions` | position sur l'appareil seulement |
| 2 | Je consulte sa fiche | `/missions/:clé` | — |
| 3 | Je candidate chez l'annonceur | bouton « Candidater ↗ » | `record_application_click` |
| 4 | Après la date, je dis si j'y suis allé | carte « Alors, ta mission ? » | `declare_participation` |
| 5 | La structure confirme, l'expérience vérifiée apparaît | `/confirmer/:jeton`, espace structure, `/profil`, `/p/:id` | `answer_participation_request`, `public_participant_profile` |

Migration : `supabase/migrations/20260928120000_phase0_simple_journey.sql`.
Test SQL (toujours annulé) : `supabase/tests/phase0_journey_rollback.sql`.
Code : `src/features/journey/`.

## 1. Je vois des missions

- À l'arrivée, UROSI demande la localisation. Si elle est acceptée, les
  missions s'affichent aussitôt, triées par **proximité réelle**, y compris
  celles de la commune voisine.
- **Voir dans ma ville** affiche uniquement les missions de la commune
  détectée, jamais au-delà. La commune est trouvée par l'API Adresse
  (data.gouv.fr) ; à défaut, c'est la commune connue la plus proche.
- Si la localisation est refusée, seule la ville est demandée. Les missions
  restent visibles pendant la saisie.
- La position est arrondie à environ 100 m et reste sur l'appareil ; elle
  n'est jamais envoyée en base.
- Une carte affiche uniquement : photo, titre, structure, distance, date et
  durée.

## 2. Je consulte la fiche

La fiche montre la photo, le titre, la structure, la description, l'adresse et
la distance, la date, les horaires, la durée et les places, puis **un seul**
bouton, « Candidater ↗ ». Pour une mission externe, il est suivi de la mention
« Tu continueras ta candidature sur le site de l'organisateur. »

## 3. Je candidate

- UROSI enregistre le clic (`user_id` si la personne est connectée, sinon un
  identifiant de visiteur anonyme, la mission, la structure, la date de la
  mission, la source et la date du clic), puis ouvre **immédiatement** la page
  officielle de l'annonceur dans un nouvel onglet.
- Aucun compte n'est exigé. Après coup, UROSI propose « Créer mon profil pour
  suivre mes missions ».
- Si la personne crée un compte, les candidatures faites en visiteur
  rejoignent son profil (`claim_visitor_clicks`).
- Exception : une mission publiée directement sur UROSI demande un compte,
  car la structure doit savoir qui candidate.

## 4. Après la mission

- La carte « Alors, ta mission avec … ? » propose deux choix seulement.
  - Elle apparaît le lendemain de la date de la mission.
  - Pour une mission sans date, elle apparaît une semaine après le clic.
  - Une personne sans compte la voit aussi : sa liste est gardée sur son
    appareil.
- **Je n'y suis pas allé** : la carte se ferme et rien n'est ajouté au profil.
- **J'y suis allé** : UROSI enregistre `participant_declared_completed = true`
  et le statut devient `completed_declared`. La mission apparaît comme
  « Déclarée par toi · en attente de confirmation », dans l'espace privé
  seulement. Ce n'est **jamais** une vérification.

## 5. La structure confirme

Deux cas :

- **Mission d'une plateforme partenaire**
  - La déclaration crée un lien unique `/confirmer/:jeton`. La structure y lit
    « Hugo M. indique avoir réalisé la mission … le 28 septembre 2026.
    Pouvez-vous confirmer sa participation ? » et répond **✓ Oui, a
    participé** ou **✕ Non**, sans compte.
  - La réponse est unique et définitive. « Oui » passe la mission à
    `verified_completed`.
  - **Aucun email n'est envoyé automatiquement**, faute de service d'envoi
    configuré. Le Centre Fondateur (Missions externes → « Participations à
    confirmer ») liste les demandes avec **Copier le lien**, à transmettre à
    l'organisation.
- **Mission UROSI**
  - La structure voit « X indique avoir réalisé cette mission le … Pouvez-vous
    confirmer sa participation ? » dans son espace (et reçoit une
    notification).
  - **✓ Oui, a participé** confirme et vérifie en un seul geste.
    **✕ Non** signale l'absence.

Le profil (`/profil`) et le profil public (`/p/:id`) n'affichent que :

- la photo, le prénom et l'initiale, la ville ;
- le nombre de missions et d'heures **confirmées** ;
- les structures ;
- les expériences confirmées.

La pastille verte signifie **uniquement** que la structure a confirmé cette
participation à cette date. Le profil public est désactivé par défaut et
s'active depuis le profil (« Profil public »).

## Ce que l'utilisateur ne voit plus (conservé dans le code)

L'ancien espace participant (`src/features/participant/ParticipantApp.tsx`)
n'est plus routé. Tout est conservé pour de futures phases, mais n'apparaît
plus :

- les onglets Accueil / Favoris ;
- la recherche et les catégories ;
- les favoris ;
- les avis et notations ;
- le CV PDF ;
- le suivi de candidature étape par étape ;
- la messagerie ;
- la cloche de notifications ;
- les statuts « acceptée (déclarée) ».

N'apparaissent pas non plus pour l'utilisateur : API Engagement, l'agent, la
synchronisation, la provenance, les droits d'image, les journaux, les scores,
le QR, Stripe, le wallet, le mandat, le KYC et la couche payante (Centre
Fondateur et phases futures uniquement).
