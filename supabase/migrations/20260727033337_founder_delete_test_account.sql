-- Permet au Fondateur de supprimer definitivement un compte de test depuis
-- le Centre Fondateur. Supprime la ligne profiles (jamais un vrai compte :
-- garde explicite sur is_founder_test_account + role), ce qui entraine en
-- cascade (FK on delete cascade deja en place) la suppression de la
-- structure possedee, ses missions, candidatures, evaluations, etc. Le
-- compte auth.users correspondant est supprime separement, cote edge
-- function (seule l'API Admin Auth, hors PostgREST, peut le faire).
create or replace function public.founder_delete_test_account(
  p_account_id uuid,
  p_as text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  perform private.assert_founder();

  if p_as = 'structure' then
    v_role := 'structure_admin';
  elsif p_as = 'worker' then
    v_role := 'worker';
  else
    raise exception 'Parametre p_as invalide : worker ou structure attendu.';
  end if;

  delete from public.profiles
  where id = p_account_id
    and is_founder_test_account
    and role = v_role;

  if not found then
    raise exception 'Compte de test introuvable.';
  end if;
end;
$$;

revoke execute on function public.founder_delete_test_account(uuid, text) from public, anon;
grant execute on function public.founder_delete_test_account(uuid, text) to authenticated;
