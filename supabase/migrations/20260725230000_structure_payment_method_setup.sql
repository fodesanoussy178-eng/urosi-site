-- Enregistrement du moyen de paiement structure — MODULE 2 etape 2.
--
-- Aucune donnee de paiement a l'inscription. Le moyen de paiement (carte,
-- Apple Pay, Google Pay) n'est demande qu'au moment de la premiere
-- publication d'une mission dont le montant est superieur a 0 — jamais pour
-- une structure qui ne publie que du solidaire (verifie cote frontend avant
-- meme d'appeler stripe-setup-payment-method : voir StructureApp.tsx).
--
-- Un SetupIntent (usage: off_session) tokenise le moyen de paiement SANS
-- debit. Une fois confirme cote client, le webhook setup_intent.succeeded
-- rattache le payment_method au Customer Stripe de la structure et le
-- retient comme moyen par defaut ici. C'est ce payment_method_id qui sera
-- utilise par les futures autorisations bancaires automatiques (etape 3),
-- jamais redemande a chaque mission.
alter table public.structures add column if not exists stripe_default_payment_method_id text;

create or replace function public.set_structure_default_payment_method(
  p_stripe_customer_id text,
  p_payment_method_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_structure record;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  select id, owner_id, name into v_structure
  from public.structures
  where stripe_customer_id = p_stripe_customer_id;

  if not found then
    return; -- Customer inconnu (hors perimetre UROSI) : rien a faire.
  end if;

  update public.structures
  set stripe_default_payment_method_id = p_payment_method_id
  where id = v_structure.id;

  perform public.notify(
    v_structure.owner_id, 'payment_method_saved', 'Moyen de paiement enregistré',
    'Ta carte (ou Apple Pay / Google Pay) est enregistrée. Elle sera utilisée automatiquement pour provisionner tes prochaines missions rémunérées.',
    jsonb_build_object('structure_id', v_structure.id)
  );
end;
$$;

revoke execute on function public.set_structure_default_payment_method(text, text) from public, anon, authenticated;
grant execute on function public.set_structure_default_payment_method(text, text) to service_role;

-- Echec d'enregistrement du moyen de paiement (setup_intent.setup_failed) :
-- notifie la structure, ne bloque rien (elle pourra reessayer).
create or replace function public.notify_structure_setup_failed(
  p_stripe_customer_id text,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_structure record;
begin
  if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Reserve au backend UROSI.';
  end if;

  select id, owner_id into v_structure
  from public.structures
  where stripe_customer_id = p_stripe_customer_id;

  if not found then
    return;
  end if;

  perform public.notify(
    v_structure.owner_id, 'payment_method_failed', 'Enregistrement du moyen de paiement échoué',
    'Ta carte n''a pas pu être enregistrée (' || coalesce(p_reason, 'raison inconnue') || '). Réessaie depuis la publication de ta mission.',
    jsonb_build_object('structure_id', v_structure.id, 'reason', p_reason)
  );
end;
$$;

revoke execute on function public.notify_structure_setup_failed(text, text) from public, anon, authenticated;
grant execute on function public.notify_structure_setup_failed(text, text) to service_role;
