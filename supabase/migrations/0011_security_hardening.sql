-- 0011 : durcissement securite (suite aux advisors Supabase).
-- - search_path fige sur les fonctions calendaires
-- - les fonctions trigger ne sont executables par aucun client
-- - les RPC reservees aux utilisateurs connectes ne sont plus executables par anon

alter function public.easter_date(integer) set search_path = '';
alter function public.is_french_holiday(date) set search_path = '';

-- Fonctions trigger : jamais appelees par un client.
revoke execute on function public.enforce_consecutive_days_cap() from public, anon, authenticated;
revoke execute on function public.enforce_structure_subscription() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.missions_apply_pricing() from public, anon, authenticated;
revoke execute on function public.wallet_apply_transaction() from public, anon, authenticated;
revoke execute on function public.trg_profile_wallet() from public, anon, authenticated;
revoke execute on function public.trg_pay_on_completion() from public, anon, authenticated;
revoke execute on function public.trg_notify_new_application() from public, anon, authenticated;
revoke execute on function public.trg_notify_application_status() from public, anon, authenticated;
revoke execute on function public.trg_notify_rating() from public, anon, authenticated;
revoke execute on function public.trg_notify_message() from public, anon, authenticated;
revoke execute on function public.trg_notify_delay() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- RPC reservees aux utilisateurs connectes : anon n'a rien a y faire.
revoke execute on function public.deposit_wallet(bigint, text) from anon;
revoke execute on function public.withdraw_wallet(bigint) from anon;
revoke execute on function public.subscribe_structure(uuid) from anon;
revoke execute on function public.structure_stats(uuid) from anon;
revoke execute on function public.worker_stats() from anon;
revoke execute on function public.worker_cv(uuid) from anon;
revoke execute on function public.compute_mission_pricing(uuid, integer, date, time, integer, text, integer, boolean, numeric) from anon;
revoke execute on function public.process_mission_payment(uuid) from anon;
