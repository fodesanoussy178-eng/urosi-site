-- Active pg_cron + pg_net et programme les 4 taches planifiees backend :
--   - release-due-payments  (liberation J+3)                      : horaire
--   - recheck-siret         (reverification SIRET workers)        : quotidien
--   - authorize-missions    (Module 2, pose l'autorisation)       : horaire
--   - capture-missions      (Module 2, capture/annule l'autorisation) : horaire
--
-- Authentification : chaque appel HTTP porte l'en-tete Authorization avec
-- la cle service_role, lue depuis Vault (jamais en clair dans cette
-- migration). Le secret doit etre cree manuellement UNE FOIS, hors SQL :
--   Dashboard -> Project Settings -> Vault -> New secret
--   nom EXACT "service_role_key", valeur = la cle service_role du projet
--   (Dashboard -> Project Settings -> API).
-- Tant que ce secret n'existe pas, net.http_post echoue (visible dans
-- net._http_response) mais ne bloque jamais le scheduler pg_cron lui-meme.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'release-due-payments-hourly',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://nksxwbkpazcyoumcwzll.supabase.co/functions/v1/release-due-payments',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'recheck-siret-daily',
  '15 3 * * *',
  $$
  select net.http_post(
    url := 'https://nksxwbkpazcyoumcwzll.supabase.co/functions/v1/recheck-siret',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'authorize-missions-hourly',
  '10 * * * *',
  $$
  select net.http_post(
    url := 'https://nksxwbkpazcyoumcwzll.supabase.co/functions/v1/authorize-missions',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'capture-missions-hourly',
  '20 * * * *',
  $$
  select net.http_post(
    url := 'https://nksxwbkpazcyoumcwzll.supabase.co/functions/v1/capture-missions',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
