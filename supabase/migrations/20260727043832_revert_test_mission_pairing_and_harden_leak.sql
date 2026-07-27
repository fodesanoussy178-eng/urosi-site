-- 1. Revert l'isolation par rattachement introduite dans
--    20260727033218_founder_test_structure_pairing_isolation.sql : elle
--    cassait la fidelite avec l'appli reelle (un vrai worker voit TOUTES
--    les missions ouvertes de TOUTES les structures, jamais seulement
--    "sa" structure). Le vrai probleme observe a l'epoque etait une
--    structure de test orphelinee sans mission (bug corrige separement,
--    20260727042058_fix_founder_test_mission_solidaire.sql), pas un besoin
--    d'isolement entre comptes de test. On revient a la regle simple :
--    tout compte de test Fondateur (ou le fondateur reel) voit toutes les
--    missions de test, exactement comme un vrai utilisateur verrait toutes
--    les missions reelles.
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

drop policy if exists "missions: read open or own structure" on public.missions;
create policy "missions: read open or own structure"
  on public.missions for select
  to public
  using (
    (status = 'open' and (not is_founder_test_mission(structure_id) or is_founder_test_viewer()))
    or is_structure_owner(structure_id)
  );

drop function if exists public.is_founder_test_mission_paired_to_viewer(uuid);

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

-- 2. Durcissement anti-fuite vers la vraie appli : deux policies mortes
--    referencent encore le schema gele legacy_20260715 (structures/
--    mission_status d'avant la reforme de schema du 15/07). Elles ne
--    matchent plus aucune donnee actuelle (aucune mission n'a jamais
--    status='published' aujourd'hui, verifie ; aucune structure recente
--    n'existe dans cette copie figee) mais restent un risque latent : si un
--    jour une ecriture quelconque repositionne status='published', TOUT
--    utilisateur authentifie — reel y compris — verrait cette mission,
--    fondateur-test ou non, sans le filtre is_founder_test_mission. On les
--    supprime : les policies actuelles ("missions: read open or own
--    structure", "missions: owner update/delete") couvrent deja tous les
--    cas legitimes avec le bon filtre.
drop policy if exists "structure owners can read own missions" on public.missions;
drop policy if exists "structure owners can update missions" on public.missions;
drop policy if exists "workers can read published missions" on public.missions;
