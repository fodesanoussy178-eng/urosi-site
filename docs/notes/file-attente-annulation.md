# Note technique — File d'attente et redistribution après annulation (app réelle)

> Statut : SPÉCIFICATION. La démo illustre déjà le comportement
> (bannière d'annulation côté structure + proposition de la file
> d'attente, ajoutées le 16/07/2026). L'implémentation réelle touche le
> schéma, les gardes de cycle de vie et le backend planifié : elle doit
> passer par de nouvelles migrations + revue sécurité, pas par un patch
> front.

## Comportement cible (demande produit du 16/07/2026)

1. Quand un travailleur annule une mission acceptée :
   - la structure voit immédiatement « X a annulé sa participation » ;
   - UROSI propose automatiquement la place aux candidats en file
     d'attente (candidatures `pending` de la même mission), dans les
     **2 minutes maximum** ;
   - à défaut de file d'attente, la mission repart dans le flux des
     travailleurs disponibles.
2. Sur-réservation préventive : même si la structure demande N places,
   UROSI garde **2 à 3 candidats de plus en attente** (statut « standby »)
   pour absorber les annulations sans délai.

## Points d'ancrage dans l'existant

- `applications.status` : cycle verrouillé par
  `guard_application_state_and_capacity` (migration `20260715150000`) —
  l'acceptation au-delà de `missions.places` est refusée aujourd'hui.
  Le standby doit donc être un **statut distinct** (`waitlisted`), pas des
  `accepted` surnuméraires, pour ne pas affaiblir la garde de capacité.
- Annulation travailleur : transition `accepted → cancelled` déjà permise.
  Il manque la réaction : notification structure + promotion du premier
  `waitlisted`.
- Aucun planificateur n'existe encore (cf. note H2 sur la libération J+3) :
  la promesse « 2 minutes max » exige le même socle (Edge Function
  planifiée `service_role` — `supabase/functions/release-due-payments`
  sert de modèle) ou un trigger + notification realtime immédiate.

## Implémentation proposée (nouvelles migrations uniquement)

1. **Statut `waitlisted`** : étendre l'enum/contrainte de
   `applications.status` + politique d'affichage (le travailleur voit
   « en file d'attente », la structure voit la file classée).
2. **Trigger `after update` sur `applications`** (`security definer`,
   nouvelle migration) : sur transition `accepted → cancelled`,
   - insérer une notification structure (`public.notify`) « X a annulé » ;
   - promouvoir automatiquement le premier `waitlisted → pending` mis en
     avant, ou notifier les candidats `pending` existants ;
   - journaliser dans `reliability_events` (existant : `subject_type`,
     `event_type`) pour le score de fiabilité.
3. **Republication automatique** : si aucune candidature en attente,
   marquer la mission pour re-diffusion (le flux realtime `missions-feed`
   existant réaffiche déjà toute mission `open` modifiée).
4. **Capacité standby** : accepter jusqu'à `places + 3` candidatures en
   `waitlisted` (jamais en `accepted`) — la garde de capacité actuelle
   reste inchangée pour `accepted`.
5. **Délai de 2 minutes** : la notification est instantanée (trigger).
   Si un délai de courtoisie est voulu avant la promotion automatique,
   utiliser le planificateur commun (voir note H2) plutôt qu'un `pg_sleep`.

## Interdits

- Ne pas contourner `guard_application_state_and_capacity` ni les
  transitions réservées `service_role`.
- Ne pas éditer les migrations déjà appliquées : nouvelles migrations
  horodatées uniquement.
- Aucun impact sur la logique financière (commission, wallet, J+3).
