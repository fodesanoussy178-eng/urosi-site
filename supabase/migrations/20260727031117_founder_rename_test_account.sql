-- Permet au Fondateur de renommer un compte de test directement depuis le
-- Centre Fondateur (liste des comptes de test), sans repasser par
-- founder-test-mode. Pour un worker, on renomme profiles.full_name (le seul
-- "nom" affiche pour ce role). Pour une structure, on renomme
-- structures.name (l'identite affichee/testee pour ce role — un vrai
-- structure_admin n'a d'ailleurs aucun ecran pour editer son propre
-- full_name dans l'appli reelle, seule structures.name/trade_name compte).
create or replace function public.founder_rename_test_account(
  p_account_id uuid,
  p_as text,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.assert_founder();

  if v_name = '' then
    raise exception 'Le nom ne peut pas etre vide.';
  end if;

  if p_as = 'structure' then
    update public.structures s
    set name = v_name
    from public.profiles p
    where p.id = s.owner_id
      and s.owner_id = p_account_id
      and p.is_founder_test_account
      and p.role = 'structure_admin';
  elsif p_as = 'worker' then
    update public.profiles
    set full_name = v_name
    where id = p_account_id
      and is_founder_test_account
      and role = 'worker';
  else
    raise exception 'Parametre p_as invalide : worker ou structure attendu.';
  end if;

  if not found then
    raise exception 'Compte de test introuvable.';
  end if;
end;
$$;

revoke execute on function public.founder_rename_test_account(uuid, text, text) from public, anon;
grant execute on function public.founder_rename_test_account(uuid, text, text) to authenticated;
