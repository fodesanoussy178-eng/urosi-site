-- Grant manquant en production (deja present sur staging) : la policy RLS
-- "rating_requests: reviewer reads own" (reviewer_id = auth.uid()) restreint
-- deja l'acces ligne par ligne, mais sans un GRANT SELECT au role
-- `authenticated`, PostgREST refuse la requete avant meme d'evaluer la policy
-- ("permission denied for table rating_requests"). Purement un alignement de
-- privilege, aucune regle metier modifiee : la policy existante reste la
-- seule source de verite sur qui voit quoi.
grant select on public.rating_requests to authenticated;
