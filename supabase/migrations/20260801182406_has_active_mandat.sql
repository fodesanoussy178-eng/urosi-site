-- Fonction de garde du mandat.
--
-- APPLIQUEE EN PRODUCTION le 2026-08-01. Les policies qui l'utilisent sont
-- dans la migration suivante, volontairement separee (voir son en-tete).
--
-- Volontairement non versionnee : elle accepte n'importe quelle version de
-- mandat non revoquee. Une nouvelle version des CGU ne doit pas bloquer une
-- mission deja en cours.

create or replace function public.has_active_mandat()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.mandat_acceptances
     where user_id = auth.uid()
       and revoked_at is null
  );
$function$;

revoke execute on function public.has_active_mandat() from anon;

comment on function public.has_active_mandat() is
  'Vrai si l utilisateur courant a un mandat accepte et non revoque, toutes versions confondues.';
