-- La bascule vers un compte de test existant (founder-test-mode, mode
-- 'switch') resolvait l'account_id via une requete PostgREST brute avec la
-- cle service_role (adminClient.from('profiles')...), qui echouait en
-- production ("Compte de test introuvable.") alors que la meme ligne est
-- lisible sans probleme via founder_test_accounts_list() (RPC executee avec
-- la session du fondateur). On aligne la resolution sur ce chemin deja
-- fiable plutot que de continuer a deboguer la voie service_role.
create or replace function public.founder_resolve_test_account(
  p_account_id uuid,
  p_as text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_id uuid;
begin
  perform private.assert_founder();

  if p_as = 'structure' then
    v_role := 'structure_admin';
  elsif p_as = 'worker' then
    v_role := 'worker';
  else
    raise exception 'Parametre p_as invalide : worker ou structure attendu.';
  end if;

  select p.id into v_id
  from public.profiles p
  where p.id = p_account_id
    and p.is_founder_test_account
    and p.role = v_role;

  return v_id;
end;
$$;

revoke execute on function public.founder_resolve_test_account(uuid, text) from public, anon;
grant execute on function public.founder_resolve_test_account(uuid, text) to authenticated;
