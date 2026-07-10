-- Jeu de donnees de demonstration pour le developpement local uniquement.
-- Applique par `supabase db reset` (CLI). Ne JAMAIS executer sur la prod :
-- ce script cree de faux utilisateurs auth.users avec un mot de passe connu.

insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'structure-demo@urosi.test', crypt('demo-password', gen_salt('bf')), now(), '{"full_name":"Association Demo","role":"structure_admin"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'worker-demo@urosi.test', crypt('demo-password', gen_salt('bf')), now(), '{"full_name":"Worker Demo","role":"worker"}', 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.structures (id, owner_id, name, siret)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Association Demo MEL', '00000000000000')
on conflict (id) do nothing;

insert into public.missions (id, structure_id, title, detail, city, scheduled_date, duration_minutes, worker_rate_cents, status)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Aide evenementielle', 'Accueil et logistique pour un forum associatif.', 'Lille', current_date + interval '3 day', 240, 6800, 'open'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Distribution alimentaire', 'Preparation et distribution de colis.', 'Roubaix', current_date + interval '5 day', 180, 5400, 'open')
on conflict (id) do nothing;
