-- Publie public.applications sur supabase_realtime.
--
-- Sans cela, un abonnement postgres_changes côté client sur `applications`
-- ne reçoit jamais rien : Postgres ne diffuse pas les changements de cette
-- table sur le slot de réplication que Realtime écoute. C'était déjà le cas
-- pour missions/notifications/messages/attendance_events, mais applications
-- avait été oubliée — l'onglet Candidats de la structure ne se mettait donc
-- jamais à jour en direct après une nouvelle candidature (seule la cloche de
-- notifications, sur une table publiée, réagissait).
alter publication supabase_realtime add table public.applications;
