-- Corrige founder_provision_test_mission : le choix "mission solidaire"
-- echouait systematiquement des que la structure de test tiree au hasard
-- n'etait pas une association, a cause de deux gardes-fous deja en place
-- sur public.missions (trg_solidaire_association_only, migration
-- 20260726110859_worker_paid_mission_unlock.sql) que la version precedente
-- de cette fonction ne respectait pas :
--   1. une mission solidaire ne peut appartenir qu'a une structure avec
--      structures.is_association = true ;
--   2. no_salaried_substitution doit etre a true pour une mission solidaire
--      (attestation obligatoire), jamais laisse a sa valeur par defaut.
-- Consequence observee : la structure etait bien creee (RPC precedente,
-- deja validee) mais l'insertion de la mission echouait et remontait
-- l'erreur — structure de test sans aucune mission. La selection du
-- template de structure (cote edge function) doit aussi etre corrigee pour
-- ne proposer que des templates association quand solidaire est demande ;
-- voir la mise a jour de supabase/functions/founder-test-mode/index.ts.
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

  if p_is_solidaire and not coalesce(v_structure.is_association, false) then
    raise exception 'Cette structure de test n''est pas une association : impossible d''y creer une mission solidaire.';
  end if;

  select * into v_row from public.missions
  where structure_id = p_structure_id
  order by created_at asc
  limit 1;
  if v_row.id is not null then
    return v_row;
  end if;

  insert into public.missions (
    structure_id, title, detail, city, address, scheduled_date, positions,
    worker_amount, worker_rate_cents, mission_category, is_solidaire, no_salaried_substitution, status, slots
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
    'inventaire', p_is_solidaire, p_is_solidaire, 'open',
    jsonb_build_array(jsonb_build_object('date', v_date::text, 'start', '12:00', 'end', '15:00'))
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.founder_provision_test_mission(uuid, boolean) from public, anon;
grant execute on function public.founder_provision_test_mission(uuid, boolean) to authenticated;
