-- Durcissement final des fonctions historiques creees avant les migrations
-- KYC/Fondateur. PostgreSQL accorde EXECUTE a PUBLIC par defaut : retirer le
-- droit uniquement a anon ne suffit donc pas, car anon herite de PUBLIC.

alter function public.safe_worker_name(text) set search_path = '';
alter function public.mission_day_name(timestamptz) set search_path = '';
alter function public.mission_time_slot(timestamptz, timestamptz) set search_path = '';

-- Helpers SECURITY DEFINER utilises par les politiques RLS. Ils restent
-- disponibles pour les utilisateurs connectes, mais ne sont plus des RPC
-- publiques anonymes.
revoke execute on function public.can_access_application(uuid) from public, anon;
revoke execute on function public.is_my_applicant(uuid) from public, anon;
revoke execute on function public.is_structure_owner(uuid) from public, anon;
revoke execute on function public.mission_is_open(uuid) from public, anon;
revoke execute on function public.owns_completed_application(uuid) from public, anon;
revoke execute on function public.owns_mission(uuid) from public, anon;
revoke execute on function public.structure_has_open_mission(uuid) from public, anon;

grant execute on function public.can_access_application(uuid) to authenticated;
grant execute on function public.is_my_applicant(uuid) to authenticated;
grant execute on function public.is_structure_owner(uuid) to authenticated;
grant execute on function public.mission_is_open(uuid) to authenticated;
grant execute on function public.owns_completed_application(uuid) to authenticated;
grant execute on function public.owns_mission(uuid) to authenticated;
grant execute on function public.structure_has_open_mission(uuid) to authenticated;

-- RPC metier appelees par l'application ou par une Edge Function avec le JWT
-- de l'utilisateur. Elles doivent etre authentifiees, jamais anonymes.
revoke execute on function public.compute_mission_pricing(
  uuid, integer, date, time, integer, text, integer, boolean, numeric
) from public, anon;
revoke execute on function public.deposit_wallet(bigint, text) from public, anon;
revoke execute on function public.subscribe_structure(uuid) from public, anon;
revoke execute on function public.withdraw_wallet(bigint) from public, anon;
revoke execute on function public.worker_cv(uuid) from public, anon;
revoke execute on function public.worker_stats() from public, anon;

grant execute on function public.compute_mission_pricing(
  uuid, integer, date, time, integer, text, integer, boolean, numeric
) to authenticated;
grant execute on function public.deposit_wallet(bigint, text) to authenticated;
grant execute on function public.subscribe_structure(uuid) to authenticated;
grant execute on function public.withdraw_wallet(bigint) to authenticated;
grant execute on function public.worker_cv(uuid) to authenticated;
grant execute on function public.worker_stats() to authenticated;

-- Les jetons QR sont accessibles uniquement via les RPC controlees.
revoke all on table public.mission_qr_tokens from public, anon, authenticated;

-- Le registre d'acces Fondateur est pilote par les fonctions dediees.
revoke all on table public.founder_access from public, anon, authenticated;
