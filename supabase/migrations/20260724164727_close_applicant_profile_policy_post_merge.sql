-- Suite de 20260724140000 (staging) et de la restauration temporaire
-- 20260724160724 (production, le temps que le nouveau frontend soit validé
-- sur Preview). Le nouveau frontend est maintenant fusionné sur main et
-- déployé : il ne dépend plus de cette policy (il passe uniquement par
-- applicants_display_names). On referme donc l'accès direct au nom légal
-- complet d'un candidat pour les structures.
drop policy if exists "profiles: structures read applicant profiles" on public.profiles;
