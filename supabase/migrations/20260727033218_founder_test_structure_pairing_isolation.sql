-- Isolation entre structures de test independantes.
--
-- Avant : is_founder_test_viewer() ne verifiait que "ce compte est-il un
-- compte de test Fondateur ?", sans jamais comparer a QUELLE structure de
-- test il appartient. Tant qu'il n'existait qu'UN SEUL couple worker/
-- structure de test, c'etait equivalent a "voit ses propres missions de
-- test". Depuis que le Centre Fondateur permet de creer plusieurs
-- structures de test independantes (chacune avec ses propres travailleurs
-- de test), ce predicat rouvrait la visibilite de TOUTES les missions de
-- TOUTES les structures de test a TOUT compte de test — fuite entre
-- structures qui sont censees etre independantes.
--
-- Fix : chaque travailleur de test est desormais explicitement rattache a
-- UNE structure de test (paired_test_structure_id, choisi a la creation
-- dans le Centre Fondateur) et ne voit que les missions de celle-ci. La
-- vraie session Fondateur (has_founder_access, jamais en mode test) garde
-- une vue complete pour la supervision.

alter table public.profiles
  add column if not exists paired_test_structure_id uuid references public.structures(id) on delete set null;

comment on column public.profiles.paired_test_structure_id is
  'Uniquement pour is_founder_test_account=true (role worker) : structure de test a laquelle ce compte est rattache, seule dont il voit les missions.';

-- Backfill : les travailleurs de test crees avant ce correctif n''avaient
-- aucune notion de rattachement — on les associe a la plus ancienne
-- structure de test existante, qui correspond a l''hypothese implicite d''un
-- seul couple worker/structure valable avant l''introduction du multi-compte.
update public.profiles p
set paired_test_structure_id = (
  select s.id
  from public.structures s
  join public.profiles owner on owner.id = s.owner_id
  where owner.is_founder_test_account
  order by s.created_at asc
  limit 1
)
where p.is_founder_test_account
  and p.role = 'worker'
  and p.paired_test_structure_id is null;

create or replace function public.is_founder_test_mission_paired_to_viewer(p_structure_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    public.has_founder_access()
    or exists (
      select 1 from public.profiles
      where id = (select auth.uid())
        and is_founder_test_account
        and paired_test_structure_id = p_structure_id
    )
  )
$$;

revoke execute on function public.is_founder_test_mission_paired_to_viewer(uuid) from public;
grant execute on function public.is_founder_test_mission_paired_to_viewer(uuid) to anon, authenticated;

drop policy if exists "missions: read open or own structure" on public.missions;
create policy "missions: read open or own structure"
  on public.missions for select
  to public
  using (
    (status = 'open' and (not is_founder_test_mission(structure_id) or is_founder_test_mission_paired_to_viewer(structure_id)))
    or is_structure_owner(structure_id)
  );

-- Meme rattachement applique cote ecriture : un travailleur de test ne peut
-- candidater qu'aux missions de SA structure de test rattachee (au lieu de
-- "n'importe quelle structure de test"), en plus de l'isolation test/reel
-- deja en place ci-dessous.
create or replace function public.guard_test_account_isolation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_is_test boolean;
  v_worker_paired_structure_id uuid;
  v_mission_structure_id uuid;
  v_structure_is_test boolean;
begin
  select coalesce(is_founder_test_account, false), paired_test_structure_id
  into v_worker_is_test, v_worker_paired_structure_id
  from public.profiles where id = new.worker_id;

  select m.structure_id, coalesce(p.is_founder_test_account, false)
  into v_mission_structure_id, v_structure_is_test
  from public.missions m
  join public.structures s on s.id = m.structure_id
  join public.profiles p on p.id = s.owner_id
  where m.id = new.mission_id;

  if v_worker_is_test is distinct from v_structure_is_test then
    raise exception 'Isolation test Fondateur : un compte de test ne peut interagir qu''avec d''autres comptes de test.';
  end if;

  if v_worker_is_test and v_worker_paired_structure_id is distinct from v_mission_structure_id then
    raise exception 'Isolation test Fondateur : ce compte de test n''est pas rattache a cette structure de test.';
  end if;

  return new;
end;
$$;

-- founder_mark_test_account pose desormais le rattachement au moment de la
-- creation d'un compte de test worker (parametre optionnel, ignore pour un
-- compte structure). Un appel qui ne le fournit pas ne touche pas un
-- rattachement deja existant (coalesce), pour rester sans danger si jamais
-- rappele hors creation. Un nouveau parametre change la signature : on
-- retire explicitement l'ancienne version a 7 arguments, sinon
-- "create or replace" cree un second overload au lieu de la remplacer.
drop function if exists public.founder_mark_test_account(uuid, text, text, text, text, text[], text);

create or replace function public.founder_mark_test_account(
  p_user_id uuid,
  p_full_name text,
  p_city text default null,
  p_phone text default null,
  p_bio text default null,
  p_skills text[] default null,
  p_address text default null,
  p_paired_test_structure_id uuid default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_row public.profiles;
begin
  perform private.assert_founder();

  select email into v_email from auth.users where id = p_user_id;
  if v_email is null or v_email not like '%@urosi.internal' then
    raise exception 'Seuls les comptes du domaine interne de test (@urosi.internal) peuvent etre marques comme compte de test Fondateur.';
  end if;

  update public.profiles
  set is_founder_test_account = true,
      full_name = p_full_name,
      city = coalesce(p_city, city),
      phone = coalesce(p_phone, phone),
      bio = coalesce(p_bio, bio),
      skills = coalesce(p_skills, skills),
      address = coalesce(p_address, address),
      paired_test_structure_id = coalesce(p_paired_test_structure_id, paired_test_structure_id)
  where id = p_user_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.founder_mark_test_account(uuid, text, text, text, text, text[], text, uuid) from public, anon;
grant execute on function public.founder_mark_test_account(uuid, text, text, text, text, text[], text, uuid) to authenticated;

-- founder_test_accounts_list expose desormais le rattachement (id + nom de
-- la structure) pour chaque travailleur de test, afin de l'afficher dans le
-- Centre Fondateur.
create or replace function public.founder_test_accounts_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_founder();
  return jsonb_build_object(
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', u.email, 'created_at', p.created_at,
        'paired_structure_id', p.paired_test_structure_id, 'paired_structure_name', s.name
      ) order by p.created_at)
      from public.profiles p
      join auth.users u on u.id = p.id
      left join public.structures s on s.id = p.paired_test_structure_id
      where p.is_founder_test_account and p.role = 'worker'
    ), '[]'::jsonb),
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', u.email, 'created_at', p.created_at,
        'structure_id', s.id, 'structure_name', s.name
      ) order by p.created_at)
      from public.profiles p
      join auth.users u on u.id = p.id
      left join public.structures s on s.owner_id = p.id
      where p.is_founder_test_account and p.role = 'structure_admin'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.founder_test_accounts_list() from public, anon;
grant execute on function public.founder_test_accounts_list() to authenticated;
