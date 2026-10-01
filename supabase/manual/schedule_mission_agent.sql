-- A APPLIQUER A LA MAIN, UNIQUEMENT APRES :
--   1. reception de la vraie cle API Engagement et creation du secret Edge
--      Function API_ENGAGEMENT_KEY (aucune fausse cle n'est versionnee) ;
--   2. verification des autres sources (public.mission_sources : acces
--      automatise autorise, base de reutilisation ecrite, verified_at) ;
--   3. deploiement : supabase functions deploy mission-agent --no-verify-jwt ;
--   4. une execution manuelle reussie depuis le Centre Fondateur
--      (« Agent Missions » → « Relancer maintenant », statut « succès ») ;
--   5. creation dans Vault d'un secret nomme EXACTEMENT
--      "mission_agent_cron_secret", de meme valeur que le secret Edge Function
--      MISSION_AGENT_CRON_SECRET (jamais en clair dans ce fichier).
--
-- Frequence : toutes les 3 heures, a la minute 14 (00:14, 03:14, ... UTC).
-- Le Centre Fondateur affiche la prochaine execution a partir de cette
-- planification. Retrait : select cron.unschedule('mission-agent');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- L'agent remplace l'ancien import biquotidien.
select cron.unschedule(jobid) from cron.job where jobname = 'import-api-engagement';

select cron.schedule(
  'mission-agent',
  '14 */3 * * *',
  $$
  select net.http_post(
    url := 'https://nksxwbkpazcyoumcwzll.supabase.co/functions/v1/mission-agent',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mission_agent_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
