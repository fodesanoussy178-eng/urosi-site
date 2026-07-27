-- L'acces fondateur (has_founder_access) reposait sur founder_access.user_id,
-- alimente une seule fois par migration pour l'id auth.users historique de
-- fodesanoussy178@gmail.com (cf. 20260714134755_harden_worker_kyc.sql). Cette
-- ligne est liee par une FK "on delete cascade" vers profiles(id) : supprimer
-- puis recreer ce compte (nouvel id auth.users) fait disparaitre l'acces
-- fondateur sans aucun moyen de le retrouver automatiquement.
--
-- founder_emails corrige cela : cle par email normalise, jamais par id de
-- compte, donc insensible a une suppression/recreation du compte. Elle
-- s'ajoute a founder_access (toujours utile pour accorder l'acces a un
-- compte precis sans exposer son email dans une migration) et a
-- app_metadata.is_founder, sans rien retirer des mecanismes existants.

create table if not exists public.founder_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.founder_emails enable row level security;

-- Aucune policy authenticated : seules les fonctions security definer
-- (has_founder_access) lisent cette table, jamais une requete cliente directe.

create or replace function public.has_founder_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      coalesce((auth.jwt() -> 'app_metadata' ->> 'is_founder')::boolean, false)
      or exists (
        select 1
        from public.founder_access fa
        where fa.user_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.founder_emails fe
        where fe.email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
      )
    )
$$;

revoke execute on function public.has_founder_access() from public, anon;
grant execute on function public.has_founder_access() to authenticated;

-- Reattribution : le compte fondateur historique (meme email, nouvel id
-- suite a la recreation du compte) retrouve l'acces via l'email, plus besoin
-- de reinsertion manuelle par id a chaque recreation future.
insert into public.founder_emails (email)
values ('fodesanoussy178@gmail.com')
on conflict (email) do nothing;
