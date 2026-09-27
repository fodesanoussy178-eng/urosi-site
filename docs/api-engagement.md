# Import API Engagement (phase 0)

Référence : documentation officielle, dépôt `github.com/betagouv/api-engagement`
(`api/docs/openapi.yaml`, schéma `MissionLegacy`, relu au commit `f67f348`
du 25/09/2026). Le code ne suppose aucun champ non documenté ; chaque
correspondance est commentée dans `supabase/functions/_shared/apiEngagement.ts`.

## Ce qui est importé

- `GET /v0/mission?lat=50.6292&lon=3.0573&distance=25km&type=benevolat&limit=100&skip=…`
  avec l'en-tête `x-api-key`. Réponse : `{ ok, total, data, limit, skip }`.
- Uniquement le **bénévolat** (`type=benevolat`), statut `ACCEPTED`, non
  supprimé, pas 100 % à distance, sans indemnisation, non expiré. Les autres
  sont comptés par motif dans le journal d'import (`skip_reasons`).
- Clé d'upsert : `_id` (unique côté API Engagement). `clientId` et
  `publisherId` sont conservés pour le suivi (un `clientId` n'est unique que
  par annonceur).
- Mises à jour : chaque import réécrit les missions revues (`last_seen_at`,
  `source_updated_at`) ; après un parcours complet, les missions non revues
  sont désactivées (jamais supprimées).

## Tracking diffuseur

- **Clic** : `applicationUrl` renvoyé par l'API est déjà le lien tracké
  `https://api.api-engagement.beta.gouv.fr/r/{missionId}/{diffuseurId}`. UROSI
  l'ouvre tel quel, après avoir enregistré `external_application_started`.
- **Impression** : quand une carte de mission importée est visible au moins
  1,5 s, UROSI appelle une fois par session
  `GET /r/impression/{missionId}/{diffuseurId}` (dérivé du lien tracké).
- Les missions natives UROSI ne déclenchent aucun de ces appels.

## Configuration (aucune fausse clé n'est versionnée)

1. Demander la clé au chargé de déploiement API Engagement.
2. Supabase → Edge Functions → Secrets :
   - `API_ENGAGEMENT_KEY` = la clé reçue ;
   - `IMPORT_CRON_SECRET` = une valeur aléatoire longue ;
   - facultatif : `API_ENGAGEMENT_URL=https://api.bac-a-sable.api-engagement.beta.gouv.fr`
     pour tester sur le bac à sable.
3. Déployer la fonction : `supabase functions deploy import-api-engagement --no-verify-jwt`
   (l'authentification est faite dans la fonction : fondateur ou secret cron).
4. Centre Fondateur → « Missions externes » → **Relancer l'import**. Sans clé,
   le run est journalisé « non configuré » et rien n'est modifié.
5. Une fois un import manuel réussi : appliquer
   `supabase/manual/schedule_api_engagement_import.sql` (2 imports par jour).
