-- A APPLIQUER A LA MAIN, UNIQUEMENT APRES :
--   1. reception de la vraie cle API Engagement (fournie par le charge de
--      deploiement API Engagement) et creation du secret Edge Function
--      API_ENGAGEMENT_KEY ;
--   2. un import manuel reussi depuis le Centre Fondateur (section
--      « Missions externes », statut « succès ») ;
--   3. creation dans Vault d'un secret nomme EXACTEMENT
--      "import_cron_secret" dont la valeur est identique au secret Edge
--      Function IMPORT_CRON_SECRET (jamais en clair dans ce fichier).
--
-- Deux imports par jour (6h40 et 18h40 UTC). Chaque execution est tracee dans
-- public.external_import_runs (trigger = 'cron'), visible dans le Centre
-- Fondateur. Retrait : select cron.unschedule('import-api-engagement');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'import-api-engagement',
  '40 6,18 * * *',
  $$
  select net.http_post(
    url := 'https://nksxwbkpazcyoumcwzll.supabase.co/functions/v1/import-api-engagement',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'import_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
