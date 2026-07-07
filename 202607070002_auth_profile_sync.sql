create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_role text := metadata->>'role';
  safe_role public.app_role := 'worker';
  clean_siren text := regexp_replace(coalesce(metadata->>'siren', ''), '\D', '', 'g');
  clean_siret text := regexp_replace(coalesce(metadata->>'siret', ''), '\D', '', 'g');
begin
  if requested_role in ('worker', 'structure') then
    safe_role := requested_role::public.app_role;
  end if;

  insert into public.users (
    id,
    email,
    phone,
    email_verified,
    phone_verified
  )
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(metadata->>'phone', ''),
    new.email_confirmed_at is not null,
    new.phone_confirmed_at is not null
  )
  on conflict (id) do update
  set
    email = excluded.email,
    phone = coalesce(excluded.phone, public.users.phone),
    email_verified = excluded.email_verified,
    phone_verified = excluded.phone_verified;

  insert into public.profiles (
    id,
    role,
    first_name,
    last_name,
    birth_date,
    address,
    city,
    postal_code,
    phone,
    kyc_level
  )
  values (
    new.id,
    safe_role,
    nullif(metadata->>'first_name', ''),
    nullif(metadata->>'last_name', ''),
    nullif(metadata->>'birth_date', '')::date,
    nullif(metadata->>'address', ''),
    nullif(metadata->>'city', ''),
    nullif(metadata->>'postal_code', ''),
    nullif(metadata->>'phone', ''),
    1
  )
  on conflict (id) do update
  set
    first_name = coalesce(public.profiles.first_name, excluded.first_name),
    last_name = coalesce(public.profiles.last_name, excluded.last_name),
    birth_date = coalesce(public.profiles.birth_date, excluded.birth_date),
    address = coalesce(public.profiles.address, excluded.address),
    city = coalesce(public.profiles.city, excluded.city),
    postal_code = coalesce(public.profiles.postal_code, excluded.postal_code),
    phone = coalesce(public.profiles.phone, excluded.phone);

  if safe_role = 'structure'
    and length(clean_siren) = 9
    and length(clean_siret) = 14
    and nullif(metadata->>'structure_name', '') is not null
    and not exists (
      select 1
      from public.structures
      where owner_id = new.id
        and siret = clean_siret
    )
  then
    insert into public.structures (
      owner_id,
      name,
      siren,
      siret,
      address,
      city,
      postal_code,
      phone,
      verification_status
    )
    values (
      new.id,
      metadata->>'structure_name',
      clean_siren,
      clean_siret,
      coalesce(nullif(metadata->>'address', ''), 'Adresse a verifier'),
      nullif(metadata->>'city', ''),
      nullif(metadata->>'postal_code', ''),
      nullif(metadata->>'phone', ''),
      'pending'
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public;
revoke execute on function public.handle_new_auth_user() from anon;
revoke execute on function public.handle_new_auth_user() from authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

drop policy if exists "profiles own row" on public.profiles;
drop policy if exists "profiles can read own row" on public.profiles;
drop policy if exists "profiles can insert own row" on public.profiles;
drop policy if exists "profiles can update own row" on public.profiles;

create policy "profiles can read own row"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "profiles can insert own row"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "profiles can update own row"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);
