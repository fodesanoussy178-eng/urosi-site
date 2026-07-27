-- Choix solidaire/remuneree pour la mission auto-creee avec une nouvelle
-- structure de test (jusqu'ici toujours remuneree, sans alternative).
--
-- Signature changee (nouveau parametre) : on retire explicitement l'ancienne
-- version a 1 argument, sinon "create or replace" cree un second overload
-- au lieu de la remplacer.
drop function if exists public.founder_provision_test_mission(uuid);

create or replace function public.founder_provision_test_mission(
  p_structure_id uuid,
  p_is_solidaire boolean default false
)
returns public.missions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_structure public.structures;
  v_row public.missions;
  v_date date := current_date + 3;
begin
  perform private.assert_founder();

  select * into v_structure from public.structures where id = p_structure_id;
  if v_structure.id is null or v_structure.verification_method <> 'founder' then
    raise exception 'Structure de test Fondateur introuvable.';
  end if;

  -- Une seule mission auto-creee par structure de test, quel que soit le
  -- type choisi a la premiere creation : un appel ulterieur (ex. re-bascule)
  -- renvoie l'existante sans jamais en ajouter une seconde ni changer son
  -- type.
  select * into v_row from public.missions
  where structure_id = p_structure_id
  order by created_at asc
  limit 1;
  if v_row.id is not null then
    return v_row;
  end if;

  insert into public.missions (
    structure_id, title, detail, city, address, scheduled_date, positions,
    worker_amount, worker_rate_cents, mission_category, is_solidaire, status, slots
  )
  values (
    p_structure_id,
    case when p_is_solidaire then 'Rangement solidaire (test Fondateur)' else 'Inventaire magasin (test Fondateur)' end,
    case when p_is_solidaire
      then 'Rangement et tri collaboratif, mission solidaire fictive. Comptabilisée dans le CV vivant, isolée du reste de la plateforme.'
      else 'Comptage des rayons, contrôle des références et rangement léger. Mission fictive, isolée du reste de la plateforme.'
    end,
    'Lille', '1 rue Fictive', v_date, 1,
    case when p_is_solidaire then 0 else 42 end,
    case when p_is_solidaire then 0 else 4200 end,
    'inventaire', p_is_solidaire, 'open',
    jsonb_build_array(jsonb_build_object('date', v_date::text, 'start', '12:00', 'end', '15:00'))
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.founder_provision_test_mission(uuid, boolean) from public, anon;
grant execute on function public.founder_provision_test_mission(uuid, boolean) to authenticated;
