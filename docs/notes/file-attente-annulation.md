# Note technique — File d'attente et redistribution après annulation (app réelle)

> Statut : IMPLÉMENTÉ le 16/07/2026 (spécification validée par le fondateur).
> Migration `20260716140000_mission_waitlist_offers.sql`, tâche planifiée
> `supabase/functions/process-spot-offers` (à planifier toutes les minutes,
> service_role), front `spotOffersService.ts` + bannière dans `WorkerApp`.
> Décisions retenues : capacité totale = places + 3 ; offre à confirmer
> sous 2 minutes (jamais d'acceptation automatique) ; refus/expiration →
> candidat suivant ; file vide → mission remise en avant (`requeued_at`
> touché → refresh realtime du flux) ; annulation journalisée dans
> `reliability_events` (`mission_cancelled_by_worker`, weight 0, AUCUNE
> sanction automatique tant que les règles métier ne sont pas figées) ;
> aucun `pg_sleep`. Un candidat qui a refusé ou laissé expirer une offre
> n'est plus re-proposé sur la même mission ; la garde de capacité
> existante reste la seule autorité sur la transition `pending → accepted`.
>
> INVISIBILITÉ (décision du 16/07/2026) : le travailleur ne voit JAMAIS la
> file d'attente. Il postule normalement (« Participer »/« Accepter ») et
> tous les messages qui lui sont adressés restent neutres : « Mission
> disponible pour toi — confirme ta participation dans les 2 minutes »,
> « Délai de confirmation dépassé », « Cette mission n'accepte plus de
> candidatures ». Aucune mention de place libérée, de rang ou de liste
> d'attente côté travailleur ; seuls UROSI et la structure connaissent la
> mécanique de redistribution.

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
