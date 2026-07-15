-- Le schema public de la production historique a ete recree avant le rejeu des
-- migrations. Les politiques RLS ont bien ete restaurees, mais les privileges
-- de table Supabase implicites n'existaient plus. Sans ces GRANT, PostgREST
-- renvoie 403 avant meme d'evaluer la politique RLS.

do $$
declare
  target record;
  privileges text;
begin
  for target in
    select
      namespace.nspname as schema_name,
      relation.relname as table_name,
      bool_or(policy.polcmd in ('r', '*')) as allow_select,
      bool_or(policy.polcmd in ('a', '*')) as allow_insert,
      bool_or(policy.polcmd in ('w', '*')) as allow_update,
      bool_or(policy.polcmd in ('d', '*')) as allow_delete
    from pg_policy policy
    join pg_class relation on relation.oid = policy.polrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and (
        0 = any(policy.polroles)
        or 'authenticated'::regrole::oid = any(policy.polroles)
      )
    group by namespace.nspname, relation.relname
  loop
    privileges := concat_ws(
      ', ',
      case when target.allow_select then 'select' end,
      case when target.allow_insert then 'insert' end,
      case when target.allow_update then 'update' end,
      case when target.allow_delete then 'delete' end
    );

    if privileges <> '' then
      execute format(
        'grant %s on table %I.%I to authenticated',
        privileges,
        target.schema_name,
        target.table_name
      );
    end if;
  end loop;
end
$$;

-- Necessaire aux tables qui utilisent des identites/sequences lors d'un INSERT.
grant usage, select on all sequences in schema public to authenticated;

-- Les jetons QR restent exclusivement accessibles via les RPC securisees.
revoke all on table public.mission_qr_tokens from anon, authenticated;
