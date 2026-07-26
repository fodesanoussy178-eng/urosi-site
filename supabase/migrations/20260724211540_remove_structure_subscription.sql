-- UROSI n'a jamais eu d'abonnement structure en production (aucun flux de
-- paiement ne l'alimentait ; seul un accès fondateur pouvait le contourner).
-- Le seul coût côté structure est le paiement de la mission + la commission
-- UROSI (platform_settings.commission_pct), jamais un abonnement recurrent.
-- Supprime le trigger bloquant, les fonctions dediees et les colonnes.

drop trigger if exists missions_require_subscription on public.missions;
drop function if exists public.enforce_structure_subscription();
drop function if exists public.subscribe_structure(uuid);

alter table public.structures drop column if exists subscription_active;
alter table public.structures drop column if exists subscribed_at;
