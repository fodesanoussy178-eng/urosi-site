-- Doc "Reorganisation du profil utilisateur" : la structure ne doit voir que
-- le prenom du travailleur par defaut, jamais son nom legal complet, sauf si
-- le travailleur choisit explicitement d'afficher son nom de famille. Le nom
-- legal (full_name) reste la source de verite interne pour KYC/paiement.

alter table public.profiles
  add column if not exists public_first_name text,
  add column if not exists show_last_name boolean not null default false;

-- La policy precedente exposait TOUTE la ligne profils (donc le nom legal
-- complet, la ville, le telephone...) a n'importe quelle structure ayant un
-- candidat de ce profil, des qu'une requete REST le demandait — meme si le
-- frontend ne l'affichait pas. On la retire : l'unique chemin d'acces pour
-- une structure devient la fonction ci-dessous, qui ne renvoie jamais que le
-- nom d'affichage calcule.
drop policy if exists "profiles: structures read applicant profiles" on public.profiles;

create or replace function public.applicants_display_names(p_worker_ids uuid[])
returns table (worker_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    case
      when p.show_last_name and p.full_name is not null and position(' ' in p.full_name) > 0
        then coalesce(nullif(btrim(p.public_first_name), ''), split_part(p.full_name, ' ', 1))
          || ' ' || substr(p.full_name, position(' ' in p.full_name) + 1)
      else coalesce(nullif(btrim(p.public_first_name), ''), split_part(p.full_name, ' ', 1))
    end
  from public.profiles p
  where p.id = any(p_worker_ids)
    and (
      p.id = (select auth.uid())
      or public.is_my_applicant(p.id)
      or public.has_founder_access()
    )
$$;

revoke execute on function public.applicants_display_names(uuid[]) from public, anon;
grant execute on function public.applicants_display_names(uuid[]) to authenticated;

-- Demande de suppression de compte (bouton Reglages). Simple file d'attente :
-- aucun traitement automatique ici, juste l'enregistrement horodate de la
-- demande pour traitement manuel par le support/fondateur.
create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.account_deletion_requests enable row level security;

drop policy if exists "account_deletion_requests: owner read" on public.account_deletion_requests;
create policy "account_deletion_requests: owner read"
  on public.account_deletion_requests for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.request_account_deletion(p_reason text default null)
returns public.account_deletion_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.account_deletion_requests;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.';
  end if;

  select * into v_row
  from public.account_deletion_requests
  where user_id = (select auth.uid()) and status = 'pending'
  limit 1;

  if v_row.id is not null then
    return v_row;
  end if;

  insert into public.account_deletion_requests (user_id, reason)
  values ((select auth.uid()), nullif(btrim(coalesce(p_reason, '')), ''))
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated;
