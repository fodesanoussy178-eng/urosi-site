-- Document 5 — remplacement (version simple).
--
-- Plutôt qu'annuler + rembourser, la structure peut REMPLACER le travailleur
-- d'une mission confirmée non commencée : le paiement Stripe déjà encaissé est
-- TRANSFÉRÉ au remplaçant (aucun nouveau paiement, aucun remboursement).
-- La structure choisit le remplaçant parmi les candidats de la mission ; elle
-- peut aussi prévenir des travailleurs proches pour élargir le vivier.

-- Échange atomique ancien -> nouveau travailleur, paiement transféré.
create or replace function public.replace_mission_worker(
  p_old_application_id uuid,
  p_new_application_id uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_old record;
  v_new record;
begin
  select a.id, a.mission_id, a.status, a.worker_id,
         a.stripe_payment_intent_id, a.stripe_charge_id, a.stripe_checkout_session_id,
         a.stripe_payment_status, m.structure_id
  into v_old
  from public.applications a
  join public.missions m on m.id = a.mission_id
  where a.id = p_old_application_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Candidature introuvable.';
  end if;
  if not public.is_structure_owner(v_old.structure_id) then
    raise exception using errcode = '42501', message = 'Non autorisé.';
  end if;
  if v_old.status <> 'accepted' then
    raise exception using errcode = '23514',
      message = 'Seule une mission confirmée non commencée peut être remplacée.';
  end if;
  if coalesce(v_old.stripe_payment_status, '') <> 'paid' then
    raise exception using errcode = '23514', message = 'Cette mission n''est pas payée.';
  end if;

  select a.id, a.mission_id, a.status into v_new
  from public.applications a where a.id = p_new_application_id;
  if not found or v_new.mission_id <> v_old.mission_id then
    raise exception using errcode = '23514',
      message = 'Le remplaçant doit être un candidat de la même mission.';
  end if;
  if v_new.status <> 'pending' then
    raise exception using errcode = '23514', message = 'Le remplaçant doit être un candidat en attente.';
  end if;

  -- Libère l'ancien (sans remboursement : le paiement part au remplaçant).
  update public.applications
  set stripe_payment_intent_id = null,
      stripe_charge_id = null,
      stripe_checkout_session_id = null,
      stripe_payment_status = 'transferred',
      status = 'cancelled'
  where id = p_old_application_id;

  -- Transfère le paiement et confirme le remplaçant (capacité désormais libre,
  -- stripe_payment_status='paid' => passe le garde « paiement requis »).
  update public.applications
  set stripe_payment_intent_id = v_old.stripe_payment_intent_id,
      stripe_charge_id = v_old.stripe_charge_id,
      stripe_checkout_session_id = v_old.stripe_checkout_session_id,
      stripe_payment_status = 'paid',
      status = 'accepted'
  where id = p_new_application_id;
end;
$$;

-- Prévient jusqu'à 15 travailleurs actifs de la même ville (non déjà candidats)
-- qu'une mission cherche un remplaçant. Pas d'algorithme de score : simple
-- élargissement du vivier, réutilise le flux de candidature existant.
create or replace function public.notify_replacement_search(p_mission_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_structure uuid;
  v_city text;
  v_title text;
  v_target uuid;
  v_count integer := 0;
begin
  select m.structure_id, m.city, m.title into v_structure, v_city, v_title
  from public.missions m where m.id = p_mission_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Mission introuvable.';
  end if;
  if not public.is_structure_owner(v_structure) then
    raise exception using errcode = '42501', message = 'Non autorisé.';
  end if;
  if v_city is null then
    return 0;
  end if;

  for v_target in
    select p.id from public.profiles p
    where p.role = 'worker'
      and coalesce(p.account_status, 'active') <> 'suspended'
      and p.city is not null and lower(p.city) = lower(v_city)
      and not exists (
        select 1 from public.applications a
        where a.mission_id = p_mission_id and a.worker_id = p.id
      )
    limit 15
  loop
    perform public.notify(
      v_target, 'mission', 'Mission près de chez toi',
      'Une mission « ' || v_title || ' » cherche un remplaçant dans ta ville.',
      jsonb_build_object('mission_id', p_mission_id)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
