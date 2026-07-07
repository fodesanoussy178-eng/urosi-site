alter table public.structures
add column if not exists structure_type text not null default 'structure';

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
  requested_structure_type text := coalesce(nullif(metadata->>'structure_type', ''), 'structure');
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
    first_name = coalesce(excluded.first_name, public.profiles.first_name),
    last_name = coalesce(excluded.last_name, public.profiles.last_name),
    birth_date = coalesce(excluded.birth_date, public.profiles.birth_date),
    address = coalesce(excluded.address, public.profiles.address),
    city = coalesce(excluded.city, public.profiles.city),
    postal_code = coalesce(excluded.postal_code, public.profiles.postal_code),
    phone = coalesce(excluded.phone, public.profiles.phone);

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
      structure_type,
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
      requested_structure_type,
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

drop policy if exists "structures readable by authenticated" on public.structures;
drop policy if exists "structures managed by owner" on public.structures;
drop policy if exists "structures owner can read own structure" on public.structures;
drop policy if exists "structures owner can insert own structure" on public.structures;
drop policy if exists "structures owner can update own structure" on public.structures;

create policy "structures owner can read own structure"
on public.structures
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "structures owner can insert own structure"
on public.structures
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "structures owner can update own structure"
on public.structures
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "missions readable by authenticated" on public.missions;
drop policy if exists "missions managed by structure owner" on public.missions;
drop policy if exists "workers can read published missions" on public.missions;
drop policy if exists "structure owners can read own missions" on public.missions;
drop policy if exists "structure owners can create missions" on public.missions;
drop policy if exists "structure owners can update missions" on public.missions;

create policy "workers can read published missions"
on public.missions
for select
to authenticated
using (status = 'published');

create policy "structure owners can read own missions"
on public.missions
for select
to authenticated
using (
  exists (
    select 1
    from public.structures s
    where s.id = missions.structure_id
      and s.owner_id = (select auth.uid())
  )
);

create policy "structure owners can create missions"
on public.missions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.structures s
    where s.id = missions.structure_id
      and s.owner_id = (select auth.uid())
      and s.verification_status in ('pending', 'verified')
  )
);

create policy "structure owners can update missions"
on public.missions
for update
to authenticated
using (
  exists (
    select 1
    from public.structures s
    where s.id = missions.structure_id
      and s.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.structures s
    where s.id = missions.structure_id
      and s.owner_id = (select auth.uid())
      and s.verification_status in ('pending', 'verified')
  )
);
