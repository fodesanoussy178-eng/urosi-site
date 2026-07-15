-- Tests d'integration a lancer sur une base Supabase locale/staging vide :
--   supabase test db supabase/tests/commission_18.sql
-- Ils sont transactionnels et ne laissent aucune donnee.

begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(19);

select extensions.is(
  (select commission_pct::numeric from public.platform_settings where id),
  18::numeric,
  'commission structure par defaut a 18 %'
);
select extensions.is(
  (select commission_worker_pct::numeric from public.platform_settings where id),
  0::numeric,
  'aucune commission travailleur en V1'
);
select extensions.is(
  (select vat_enabled from public.platform_settings where id),
  false,
  'TVA desactivee'
);

-- Les tests complets de flux utilisent des UUID reserves a cette transaction.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'founder-test@urosi.invalid', '', '{}'::jsonb, '{"full_name":"Founder Test","role":"worker"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'worker-test@urosi.invalid', '', '{}'::jsonb, '{"full_name":"Worker Test","role":"worker"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'structure-test@urosi.invalid', '', '{}'::jsonb, '{"full_name":"Structure Test","role":"structure_admin"}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.founder_access (user_id)
values ('10000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.structures (id, owner_id, name, subscription_active)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'Structure Test', true);

insert into public.missions (
  id, structure_id, title, scheduled_date, duration_minutes,
  worker_rate_cents, base_rate_cents, is_solidaire, status
) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Mission 100 EUR', current_date, 60, 10000, 10000, false, 'open'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Mission solidaire', current_date, 60, 0, 0, true, 'open');

insert into public.applications (
  id, mission_id, worker_id, status, actual_end_at, attendance_status, payment_ready_at
) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'payment_pending', now(), 'end_confirmed', now() - interval '1 minute'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'payment_pending', now(), 'end_confirmed', now() - interval '1 minute');

insert into public.attendance_events (
  mission_id, application_id, worker_id, structure_id,
  event_type, method, confirmed_time
) values
  ('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'end_confirmed', 'support', now()),
  ('30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'end_confirmed', 'support', now());

select public.release_payment_ready_mission('40000000-0000-0000-0000-000000000001');
select public.release_payment_ready_mission('40000000-0000-0000-0000-000000000002');

select extensions.is((select worker_amount_cents from public.payments where application_id = '40000000-0000-0000-0000-000000000001'), 10000, 'travailleur recoit 100 EUR');
select extensions.is((select commission_cents from public.payments where application_id = '40000000-0000-0000-0000-000000000001'), 1800, 'commission UROSI 18 EUR');
select extensions.is((select amount_cents from public.payments where application_id = '40000000-0000-0000-0000-000000000001'), 11800, 'structure debitee 118 EUR');
select extensions.is((select count(*)::integer from public.payments where application_id = '40000000-0000-0000-0000-000000000001'), 1, 'un seul paiement');
select extensions.is((select count(*)::integer from public.platform_revenue where application_id = '40000000-0000-0000-0000-000000000001'), 1, 'une seule commission analytique');
select extensions.is((select provider_status from public.platform_revenue where application_id = '40000000-0000-0000-0000-000000000001'), 'simulated', 'revenu marque simule');
select extensions.is((select count(*)::integer from public.payments where application_id = '40000000-0000-0000-0000-000000000002'), 0, 'mission solidaire sans paiement');
select extensions.is((select count(*)::integer from public.platform_revenue where application_id = '40000000-0000-0000-0000-000000000002'), 0, 'mission solidaire sans commission');

select extensions.is(
  public.process_mission_payment('40000000-0000-0000-0000-000000000001'),
  (select id from public.payments where application_id = '40000000-0000-0000-0000-000000000001'),
  'deuxieme appel retourne le meme payment_id'
);
select extensions.is((select count(*)::integer from public.wallet_transactions where application_id = '40000000-0000-0000-0000-000000000001'), 3, 'aucune transaction wallet dupliquee');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select extensions.throws_ok(
  $$select public.process_mission_payment('40000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'un compte authentifie ne peut pas executer le paiement'
);
select extensions.is((select count(*)::integer from public.platform_revenue), 0, 'travailleur ne lit aucun revenu');
select extensions.is((select operations from public.platform_revenue_total), 0, 'vue invoker masque les operations au travailleur');

reset role;
set local role anon;
select extensions.throws_ok(
  $$select * from public.platform_revenue_total$$,
  '42501',
  null,
  'un utilisateur non connecte ne peut pas lire la vue'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select extensions.is((select total_cents from public.platform_revenue_total), 1800::bigint, 'fondateur lit le total correct');
select extensions.is((select operations from public.platform_revenue_total), 1, 'fondateur lit une operation');

select * from extensions.finish();
rollback;
