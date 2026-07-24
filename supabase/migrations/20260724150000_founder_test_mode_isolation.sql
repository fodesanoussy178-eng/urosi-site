-- Mode Fondateur = environnement de test interne, avec les memes
-- composants/regles que l'appli reelle, mais des donnees strictement
-- isolees des vrais utilisateurs :
--   1. profiles.is_founder_test_account marque un compte de test dedie
--      (worker ou structure), cree/gere par l'edge function founder-test-mode.
--   2. Les missions d'une structure de test disparaissent du flux public
--      pour tout le monde SAUF le compte de test worker et le fondateur.
--   3. Un trigger interdit qu'une candidature melange un compte de test et
--      un compte reel, quel que soit le chemin d'ecriture (RLS seule ne
--      suffit pas a l'empecher des deux cotes a la fois).

alter table public.profiles
  add column if not exists is_founder_test_account boolean not null default false;

create or replace function public.is_founder_test_mission(p_structure_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.structures s
    join public.profiles p on p.id = s.owner_id
    where s.id = p_structure_id and p.is_founder_test_account
  )
$$;

revoke execute on function public.is_founder_test_mission(uuid) from public;
grant execute on function public.is_founder_test_mission(uuid) to anon, authenticated;

create or replace function public.is_founder_test_viewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    exists (select 1 from public.profiles where id = (select auth.uid()) and is_founder_test_account)
    or public.has_founder_access()
  )
$$;

revoke execute on function public.is_founder_test_viewer() from public;
grant execute on function public.is_founder_test_viewer() to anon, authenticated;

drop policy if exists "missions: read open or own structure" on public.missions;
create policy "missions: read open or own structure"
  on public.missions for select
  to public
  using (
    (status = 'open' and (not is_founder_test_mission(structure_id) or is_founder_test_viewer()))
    or is_structure_owner(structure_id)
  );

-- Isolation au niveau ecriture : une candidature ne peut relier qu'un
-- travailleur de test a une mission de test, ou un travailleur reel a une
-- mission reelle — jamais les deux a la fois, meme via un appel API direct.
create or replace function public.guard_test_account_isolation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_is_test boolean;
  v_structure_is_test boolean;
begin
  select coalesce(is_founder_test_account, false) into v_worker_is_test
  from public.profiles where id = new.worker_id;

  select coalesce(p.is_founder_test_account, false) into v_structure_is_test
  from public.missions m
  join public.structures s on s.id = m.structure_id
  join public.profiles p on p.id = s.owner_id
  where m.id = new.mission_id;

  if v_worker_is_test is distinct from v_structure_is_test then
    raise exception 'Isolation test Fondateur : un compte de test ne peut interagir qu''avec d''autres comptes de test.';
  end if;

  return new;
end;
$$;

drop trigger if exists applications_guard_test_isolation on public.applications;
create trigger applications_guard_test_isolation
  before insert on public.applications
  for each row execute function public.guard_test_account_isolation();
