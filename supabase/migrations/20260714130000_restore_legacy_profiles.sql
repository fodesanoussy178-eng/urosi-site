-- Restaure les comptes du schema historique preserve par le script manuel
-- production_20260715_preserve_legacy_schema.sql. Sur une installation neuve,
-- le schema legacy est absent et cette migration ne fait rien.

do $$
begin
  if to_regnamespace('legacy_20260715') is null
     or to_regclass('legacy_20260715.profiles') is null then
    return;
  end if;

  execute $restore$
    insert into public.profiles (
      id,
      full_name,
      role,
      is_micro_entrepreneur,
      created_at,
      city,
      phone,
      birth_date,
      address,
      bio,
      skills,
      kyc_status,
      iban_last4
    )
    select
      old.id,
      coalesce(
        nullif(btrim(old.full_name), ''),
        nullif(btrim(concat_ws(' ', old.first_name, old.last_name)), ''),
        ''
      ),
      case old.role::text
        when 'structure' then 'structure_admin'
        else 'worker'
      end,
      coalesce(old.is_micro_entrepreneur, false),
      coalesce(old.created_at, now()),
      old.city,
      old.phone,
      old.birth_date,
      old.address,
      old.bio,
      coalesce(old.skills, '{}'::text[]),
      case old.identity_status::text
        when 'pending' then 'pending'
        when 'verified' then 'verified'
        when 'rejected' then 'rejected'
        else 'not_started'
      end,
      old.iban_last4
    from legacy_20260715.profiles old
    join auth.users account on account.id = old.id
    on conflict (id) do nothing
  $restore$;
end
$$;

-- Tout compte Auth sans profil historique recoit egalement un profil minimal.
insert into public.profiles (id, full_name, role, created_at)
select
  account.id,
  coalesce(account.raw_user_meta_data ->> 'full_name', ''),
  case
    when account.raw_user_meta_data ->> 'role' in ('structure', 'structure_admin')
      then 'structure_admin'
    else 'worker'
  end,
  coalesce(account.created_at, now())
from auth.users account
where not exists (
  select 1 from public.profiles profile where profile.id = account.id
);

-- Le compte fondateur historique est inscrit cote serveur. Le code partage
-- n'est jamais utilise pour une elevation de privilege en production.
insert into public.founder_access (user_id)
select account.id
from auth.users account
join public.profiles profile on profile.id = account.id
where lower(account.email) = 'fodesanoussy178@gmail.com'
on conflict (user_id) do nothing;
