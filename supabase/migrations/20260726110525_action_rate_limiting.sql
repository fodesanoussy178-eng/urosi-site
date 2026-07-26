-- Document 7 — point 11 (anti-abus / limites raisonnables).
--
-- Audit : une limitation de débit existe déjà, mais UNIQUEMENT pour Stripe
-- (public.consume_stripe_rate_limit, verrouillée par assert_stripe_test_enabled).
-- Les deux vecteurs d'écriture pilotés par l'utilisateur — création de
-- candidatures (travailleur) et création de missions (structure) — n'ont
-- aucune limite générale. La contrainte unique (mission_id, worker_id) empêche
-- déjà la candidature en double sur UNE mission, mais pas le spam à travers
-- plusieurs missions.
--
-- Correctif MINIMAL, sans modifier le comportement fonctionnel :
--  * un primitif de limitation GÉNÉRIQUE dans le schéma `private` (jamais
--    exposé à l'API). On ne touche PAS au limiteur Stripe existant : on ajoute
--    seulement la brique générique qui manquait, sans dupliquer sa logique
--    côté métier (le limiteur Stripe garde sa garde propre `test_enabled`) ;
--  * des seuils volontairement TRÈS hauts : aucun utilisateur normal ne les
--    atteint. Ce sont des garde-fous anti-abus, pas des quotas d'usage ;
--  * les écritures backend (service_role : remplacement, laboratoire fondateur,
--    webhooks) sont exonérées, comme toutes les autres gardes de la plateforme.

create table if not exists private.action_rate_limits (
  id bigint generated always as identity primary key,
  scope text not null,
  subject text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists action_rate_limits_lookup_idx
  on private.action_rate_limits (scope, subject, attempted_at desc);

-- Primitif générique : renvoie true si l'action est autorisée (et l'enregistre),
-- false si la limite est atteinte. Verrou transactionnel par (scope, subject)
-- pour rester correct sous concurrence, comme le limiteur Stripe.
create or replace function private.consume_action_rate_limit(
  p_scope text, p_subject text, p_max_attempts integer, p_window_seconds integer
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce(p_scope, '') = '' or coalesce(p_subject, '') = ''
     or p_max_attempts < 1 or p_window_seconds < 1 then
    raise exception using errcode = '22023', message = 'Parametres de limitation invalides.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_scope || ':' || p_subject, 0));

  -- Hygiène : purge les traces hors fenêtre pour ce sujet (table bornée).
  delete from private.action_rate_limits
  where scope = p_scope and subject = p_subject
    and attempted_at < now() - make_interval(secs => p_window_seconds);

  select count(*) into v_count
  from private.action_rate_limits
  where scope = p_scope and subject = p_subject;

  if v_count >= p_max_attempts then
    return false;
  end if;

  insert into private.action_rate_limits (scope, subject) values (p_scope, p_subject);
  return true;
end;
$$;

-- Garde-fou anti-spam sur la création de candidatures (30 / minute / travailleur).
create or replace function public.guard_application_rate_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' or auth.uid() is null then
    return new;
  end if;
  if not private.consume_action_rate_limit('application_create', new.worker_id::text, 30, 60) then
    raise exception using errcode = '53400',
      message = 'Trop de candidatures en peu de temps. Réessaie dans un instant.';
  end if;
  return new;
end;
$$;

drop trigger if exists applications_rate_limit on public.applications;
create trigger applications_rate_limit
  before insert on public.applications
  for each row execute function public.guard_application_rate_limit();

-- Garde-fou anti-spam sur la création de missions (20 / 10 min / structure).
create or replace function public.guard_mission_rate_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' or auth.uid() is null then
    return new;
  end if;
  if not private.consume_action_rate_limit('mission_create', auth.uid()::text, 20, 600) then
    raise exception using errcode = '53400',
      message = 'Trop de missions créées en peu de temps. Réessaie dans un instant.';
  end if;
  return new;
end;
$$;

drop trigger if exists missions_rate_limit on public.missions;
create trigger missions_rate_limit
  before insert on public.missions
  for each row execute function public.guard_mission_rate_limit();
