-- 0018 : acces fondateur par code discret, valide cote Supabase.
--
-- Le code n'est pas stocke en clair dans le front. Le hash du code est
-- verifie par une fonction RPC authentifiee, puis l'utilisateur est marque
-- dans founder_access. Les controles existants continuent d'appeler
-- public.is_founder().

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.founder_access (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.founder_access enable row level security;

drop policy if exists "founder_access: owner read" on public.founder_access;
create policy "founder_access: owner read"
  on public.founder_access for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.has_founder_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'fodesanoussy178@gmail.com'
    or exists (
      select 1
      from public.founder_access fa
      where fa.user_id = (select auth.uid())
    )
$$;

revoke execute on function public.has_founder_access() from public;
grant execute on function public.has_founder_access() to authenticated;

create or replace function public.claim_founder_access(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  expected_hash constant text := 'bc7aeff556985ec8cd62c92533a63a46db3f7ee549f1f8c615ec1210b0618445';
begin
  if (select auth.uid()) is null then
    return false;
  end if;

  if encode(digest(upper(btrim(coalesce(p_code, ''))), 'sha256'), 'hex') <> expected_hash then
    return false;
  end if;

  insert into public.founder_access (user_id)
  values ((select auth.uid()))
  on conflict (user_id) do nothing;

  return true;
end;
$$;

revoke execute on function public.claim_founder_access(text) from public;
grant execute on function public.claim_founder_access(text) to authenticated;

create or replace function public.is_founder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_founder_access()
$$;

revoke execute on function public.is_founder() from public;
grant execute on function public.is_founder() to authenticated;
