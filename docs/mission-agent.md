# Agent Missions : découverte automatique et enrichissement

Cette couche est **permanente**. Elle alimente le catalogue en missions
solidaires venues de sources autorisées. Pour chaque mission, elle choisit un
visuel sans jamais publier une image dont les droits sont inconnus. Elle garde
une trace de la provenance de chaque mission et de chaque image.

- Migration : `supabase/migrations/20260927120000_mission_enrichment.sql`.
  Elle suppose que la migration phase 0 (`20260926120000`) est appliquée.
- Code de l'agent : `supabase/functions/_shared/missionAgent/`.
- Edge Function : `mission-agent`. L'ancienne `import-api-engagement` délègue
  désormais à l'agent, limité à la source `api_engagement`.
- Centre Fondateur : section **Agent Missions** (`/fondateur?section=agent`).

## 1. Photos des missions natives UROSI

Une structure qui publie une mission peut ajouter **1 photo principale** et
**jusqu'à 5 photos facultatives**. L'interface offre :

- un aperçu avant publication ;
- le choix de la photo principale ;
- la suppression et le remplacement, avant publication comme depuis
  « Modifier la mission ».

Chaque photo est enregistrée dans `public.mission_images` avec les champs
`id`, `mission_id`, `image_url`, `source`, `source_url`, `rights_status`,
`is_primary` et `created_at`. S'y ajoutent `storage_path`, `position`, la
personne qui atteste les droits, la licence et l'attribution.

Règles imposées par la base de données, et pas seulement par l'interface :

- Le fichier est téléversé dans le bucket `mission-images`, dans le dossier
  `{structure_id}/{mission_id}/` de la structure. Une URL externe
  arbitraire est refusée (RLS).
- `source = 'structure_upload'` implique `rights_status = 'authorized'` et une
  attestation signée par la personne connectée. Cette attestation est une
  case à cocher obligatoire dès qu'une photo est ajoutée.
- Une mission a au maximum 6 photos et une seule photo principale. Le
  changement de photo principale passe par une opération atomique
  (`set_mission_primary_image`).
- On ne modifie pas l'URL ni la source d'une image : on la remplace, c'est-à-dire
  qu'on ajoute la nouvelle puis on supprime l'ancienne. Seule l'équipe UROSI
  peut changer le statut des droits d'une image.
- Le public ne voit que les images aux droits connus, et uniquement celles
  des missions publiées.

## 2. Hiérarchie des visuels

La règle est unique et partagée entre l'agent et l'interface
(`_shared/missionVisual.ts`) :

1. photo native fournie par la structure UROSI ;
2. image de mission explicitement fournie par une source partenaire et
   réutilisable (`partner_mission_image`), ou trouvée sur une source dont
   l'usage est autorisé (`authorized_image`), avec des droits connus ;
3. `organizationLogo` ;
4. `domainLogo` ;
5. illustration UROSI de la catégorie.

Un logo s'affiche **en médaillon** sur l'illustration de la catégorie, jamais
étiré comme une photo. Si une image ne se charge pas, l'interface passe au
niveau suivant. Aucune mission n'apparaît donc avec une zone d'image vide.

## 3. API Engagement : aucun champ inventé

La réponse de `GET /v0/mission` est construite à partir de `MISSION_FIELDS`
(`api/src/v0/mission/constants.ts` du dépôt officiel `betagouv/api-engagement`).
Elle contient `organizationLogo`, `associationLogo`, `domainLogo` et
`publisherLogo`, mais **aucune photo de mission**.

Le champ `image` du schéma d'écriture v2 (« Si absent, l'API Engagement
utilise une image de sa bibliothèque selon le domaine ») n'est pas exposé en
v0. Il n'est donc jamais lu. `organizationLogo` est toujours traité comme un
logo, jamais comme une photo.

## 4. Sources autorisées

Le registre `public.mission_sources` liste les sources de missions. L'agent
n'interroge que les sources `enabled`. La base refuse d'activer une source si
ces trois conditions ne sont pas réunies :

- `automated_access_allowed = true` ;
- une base de réutilisation écrite (`reuse_basis` : convention, licence
  ouverte, accord écrit…) ;
- une date de vérification (`verified_at`).

Types admis : `api`, `open_data`, `rss`, `xml`, `json`, `authorized_page`.
L'accès réseau passe par `_shared/missionAgent/http.ts` :

- le User-Agent est explicite (`UROSI-MissionAgent/1.0`) : pas d'imitation de
  navigateur, pas de cookies ;
- hors API officielle à clé, `robots.txt` est lu et respecté ;
- une protection anti-bot (défi, captcha, pare-feu) **arrête** la lecture de
  la source, qui est marquée « bloquée » ; aucun contournement n'est tenté ;
- un code 429 n'est réessayé qu'une fois, en respectant `Retry-After`.

Aujourd'hui, une seule source est enregistrée : **API Engagement** (`api`),
avec les logos diffusables et sans photo de mission.

### Ajouter une source

1. Vérifier et noter la base légale de réutilisation (conditions d'utilisation,
   licence, accord écrit).
2. Écrire un adaptateur dans `_shared/missionAgent/sources/` qui ne lit que des
   champs **documentés** par la source et passe par `ctx.http`.
3. L'enregistrer dans `sources/index.ts`.
4. Insérer la ligne `mission_sources` avec `enabled = false`, la faire
   vérifier, puis l'activer.
5. Déclarer `mission_images_reusable = true` seulement si la source fournit
   des photos réutilisables. Sinon, ses photos sont stockées comme « droits
   inconnus » et jamais publiées.

Les images trouvées par un adaptateur (`findImages`) portent chacune leur
statut de droits : `source_provided`, `licensed`, `authorized` ou `unknown`.
Une image `unknown` est conservée pour vérification humaine (Centre
Fondateur → « Droits vérifiés », preuve obligatoire) et n'est jamais publiée
automatiquement.

## 5. Ce que fait une exécution de l'agent

Pour chaque mission lue, l'agent :

- identifie la source et l'identifiant externe ;
- vérifie si la mission existe déjà ;
- compare une empreinte du contenu pour classer la mission en nouvelle,
  mise à jour, inchangée ou réactivée ;
- vérifie le statut et l'expiration, et exclut les missions supprimées,
  non acceptées, indemnisées, entièrement à distance ou hors bénévolat ;
- récupère la catégorie, la description, la date, le lieu, la durée, le
  nombre de places, le lien de candidature (tracké) et les logos ;
- choisit le visuel selon la hiérarchie ci-dessus.

Il gère ensuite les désactivations et les doublons :

- Une mission rejetée qui était publiée est **désactivée** avec son motif
  (`deleted_at_source`, `status_changed`, `expired`, `excluded`).
- Après un parcours **complet** d'une source, les missions qui n'y figurent
  plus sont désactivées (`removed_at_source`). Si le parcours est incomplet,
  rien n'est désactivé.
- Les missions expirées et celles d'une source désactivée sont désactivées.
  **Aucune suppression définitive** : l'historique et les candidatures restent
  intacts.
- La clé de dédoublonnage combine titre, structure, lieu et date, normalisés
  (casse, accents, ponctuation). La mission native UROSI est prioritaire, puis
  la première mission externe importée. Les doublons sont masqués du
  catalogue public.

Chaque exécution est inscrite dans le journal `external_import_runs` (avec
`source = 'mission_agent'`). Le journal compte les missions lues, nouvelles,
mises à jour, inchangées, réactivées, écartées et désactivées. Il compte aussi
les doublons, les missions sans image et les images trouvées ou refusées. Il
contient enfin un rapport par source et les erreurs.

## 6. Provenance

Colonnes de `external_missions` :

- `source` : identifiant de la source dans le registre ;
- `source_type`, `source_name` ;
- `source_url` : fiche exacte, par exemple `…/v0/mission/{_id}` ;
- `external_id` ;
- `last_checked_at`, `last_changed_at` ;
- `image_source` : niveau de visuel retenu ;
- `image_rights_status` ;
- `deactivated_at`, `deactivation_reason` ;
- `duplicate_of_*`.

Pour chaque image, `mission_images` indique `source`, `source_url`,
`rights_status`, `license` et `attribution`.

## 7. Centre Fondateur : Agent Missions

La section affiche :

- la dernière et la prochaine exécution (d'après la planification pg_cron) ;
- les sources vérifiées ;
- les missions nouvelles, mises à jour et désactivées ;
- les doublons ;
- les missions sans image ;
- les images trouvées et les images refusées pour droits inconnus ;
- les erreurs ;
- le rapport par source et le journal.

Le bouton **Relancer maintenant** déclenche une exécution immédiate. Seul un
compte fondateur peut l'utiliser ; l'Edge Function le vérifie.

## 8. Mise en service (le cron réel n'est PAS actif)

1. Appliquer les migrations `20260926120000` puis `20260927120000`.
2. Déployer la fonction :
   `supabase functions deploy mission-agent --no-verify-jwt`.
3. Créer les secrets Edge Function : `API_ENGAGEMENT_KEY` (la vraie clé,
   jamais versionnée) et `MISSION_AGENT_CRON_SECRET` (une valeur aléatoire
   longue).
4. Centre Fondateur → Agent Missions → **Relancer maintenant** : vérifier que
   le statut est « Succès ». Sans clé, le statut est « Non configuré » et rien
   n'est modifié.
5. Seulement ensuite : créer dans Vault le secret `mission_agent_cron_secret`
   (même valeur), puis appliquer `supabase/manual/schedule_mission_agent.sql`.
   L'agent tourne alors toutes les 3 heures (`14 */3 * * *`, UTC) et remplace
   l'ancien import biquotidien.

## 9. Tests

- `supabase/functions/_shared/missionAgent/*.test.ts` : orchestrateur
  (création, mise à jour, désactivations, réactivation, parcours incomplet,
  hiérarchie des visuels, droits inconnus, source non réutilisable, source
  désactivée, anti-bot, adaptateur inconnu), accès réseau (robots.txt, anti-bot,
  Retry-After) et adaptateur API Engagement.
- `supabase/functions/_shared/missionVisual.test.ts`,
  `src/components/public/MissionArt.test.tsx` : hiérarchie des visuels.
- `supabase/tests/mission_enrichment_rollback.sql` : règles de la base jouées
  sous RLS dans une transaction **toujours annulée** (upload dans le bon
  dossier, URL externe refusée, 6 photos maximum, une seule principale,
  droits non modifiables par une structure, doublons, expiration, registre des
  sources, vue Fondateur, prochaine exécution).
