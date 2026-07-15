-- Preparation exceptionnelle de la production UROSI historique.
--
-- Le schema public de juillet 2026 precede le modele suivi par les migrations
-- du depot. Il est conserve integralement et rendu inaccessible aux clients,
-- puis un schema public vide est recree avec les ACL Supabase standard.
-- Ce script ne doit etre execute qu'une seule fois, avant 0001_schema.sql.

do $$
begin
  if to_regnamespace('legacy_20260715') is not null then
    raise exception 'Le schema legacy_20260715 existe deja.';
  end if;

  if to_regclass('public.users') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.missions') is null then
    raise exception 'Le schema public ne correspond pas a la production UROSI historique attendue.';
  end if;

  if (select count(*) from public.structures) <> 0
     or (select count(*) from public.missions) <> 0
     or (select count(*) from public.applications) <> 0
     or (select count(*) from public.reviews) <> 0
     or (select count(*) from public.wallet_transactions) <> 0 then
    raise exception 'Migration refusee : des donnees metier doivent etre migrees manuellement.';
  end if;
end
$$;

alter schema public rename to legacy_20260715;

create schema public authorization pg_database_owner;
grant usage on schema public to public, postgres, anon, authenticated, service_role;

revoke all on schema legacy_20260715 from public, anon, authenticated, service_role;
grant usage on schema legacy_20260715 to postgres;

comment on schema legacy_20260715 is
  'Sauvegarde en lecture seule du schema UROSI anterieur a la migration du 15 juillet 2026.';

notify pgrst, 'reload schema';
