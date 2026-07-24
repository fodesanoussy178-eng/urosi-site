-- Le Centre Fondateur doit permettre de tester "Tester comme Structure" sans
-- devoir d'abord publier une mission a la main : une mission d'exemple,
-- ouverte, fictive et isolee (meme regle d'isolation que les comptes de
-- test : founder_provision_test_mission ne s'applique qu'a une structure
-- verification_method = 'founder') est creee automatiquement.
--
-- Volontairement minimal : seuls les champs saisis par le vrai formulaire de
-- publication sont fournis, le reste (starts_at/ends_at/duration_minutes/
-- worker_rate_cents/day_of_week/time_slot/...) est derive par les triggers
-- deja en place (missions_apply_slots, zz_missions_apply_pricing) — exactement
-- comme une vraie publication, aucune donnee financiere hors-triggers.
create or replace function public.founder_provision_test_mission(p_structure_id uuid)
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

  select * into v_row from public.missions
  where structure_id = p_structure_id and title = 'Inventaire magasin (test Fondateur)'
  limit 1;
  if v_row.id is not null then
    return v_row;
  end if;

  insert into public.missions (
    structure_id, title, detail, city, address, scheduled_date, positions,
    worker_amount, mission_category, is_solidaire, status, slots
  )
  values (
    p_structure_id,
    'Inventaire magasin (test Fondateur)',
    'Comptage des rayons, contrôle des références et rangement léger. Mission fictive, isolée du reste de la plateforme.',
    'Lille', '1 rue Fictive', v_date, 1,
    42, 'inventaire', false, 'open',
    jsonb_build_array(jsonb_build_object('date', v_date::text, 'start', '12:00', 'end', '15:00'))
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.founder_provision_test_mission(uuid) from public, anon;
grant execute on function public.founder_provision_test_mission(uuid) to authenticated;
