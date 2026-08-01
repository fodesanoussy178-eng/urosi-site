-- Acceptation du mandat (art. 1984 C. civ.) : trace horodatee, distincte des CGU.
-- Aucun bypass fondateur : un compte de test passe par le meme ecran et la meme
-- policy qu'un compte reel. La fidelite est structurelle, pas declarative.
--
-- APPLIQUE EN PRODUCTION le 2026-08-01 (deja present en staging).

create table if not exists public.mandat_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('worker', 'structure_admin')),
  version     text not null,
  accepted_at timestamptz not null default now(),
  revoked_at  timestamptz
);

create unique index if not exists mandat_acceptances_user_version_active_idx
  on public.mandat_acceptances (user_id, version)
  where revoked_at is null;

create index if not exists mandat_acceptances_user_idx
  on public.mandat_acceptances (user_id);

alter table public.mandat_acceptances enable row level security;

drop policy if exists mandat_select_own on public.mandat_acceptances;
create policy mandat_select_own
  on public.mandat_acceptances
  for select
  using (auth.uid() = user_id);

-- role doit correspondre au role reel du profil : un worker ne peut pas
-- enregistrer une acceptation de mandat structure, et inversement.
drop policy if exists mandat_insert_own on public.mandat_acceptances;
create policy mandat_insert_own
  on public.mandat_acceptances
  for insert
  with check (
    auth.uid() = user_id
    and revoked_at is null
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

-- Pas de policy update/delete : une acceptation est un fait, elle ne se
-- reecrit pas cote client. La revocation passe par revoke_own_mandat().

create or replace function public.revoke_own_mandat()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;

  update public.mandat_acceptances
     set revoked_at = now()
   where user_id = auth.uid()
     and revoked_at is null;
end;
$function$;

create or replace function public.founder_mandat_acceptances(p_limit integer default 100)
returns table(
  user_id uuid,
  full_name text,
  role text,
  version text,
  accepted_at timestamptz,
  revoked_at timestamptz,
  is_test boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not has_founder_access() then
    raise exception 'Acces reserve au fondateur';
  end if;

  return query
    select m.user_id,
           p.full_name,
           m.role,
           m.version,
           m.accepted_at,
           m.revoked_at,
           p.is_founder_test_account
      from public.mandat_acceptances m
      join public.profiles p on p.id = m.user_id
     order by m.accepted_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$function$;

-- Les deux fonctions se gardent en interne (auth.uid() / has_founder_access),
-- mais anon n'a aucune raison de pouvoir les appeler via /rest/v1/rpc/.
revoke execute on function public.revoke_own_mandat() from anon;
revoke execute on function public.founder_mandat_acceptances(integer) from anon;

comment on table public.mandat_acceptances is
  'Preuve horodatee du mandat donne a UROSI. Immuable cote client.';
