-- Traitement métier des remboursements (charge.refunded) et litiges
-- (charge.dispute.created) Stripe — appelé par l'Edge Function stripe-webhook.
--
-- Un remboursement TOTAL passe le paiement en provider_status/internal_status
-- 'refunded'. Un remboursement PARTIEL est tracé dans breakdown sans changer
-- le statut (le versement travailleur reste dû). Un litige marque le paiement
-- 'disputed' et la candidature 'disputed' côté référence Stripe ; la structure
-- est notifiée dans les deux cas.

-- Vestiges d'une itération antérieure : signatures incompatibles, supprimées
-- pour éviter toute ambiguïté PostgREST (cf. incidents overloads précédents).
drop function if exists public.record_stripe_refund(text, text, integer, text, text, text, integer, boolean);
drop function if exists public.record_stripe_dispute(text, text, integer, text, text, text, integer, boolean);

alter table public.payments drop constraint if exists payments_provider_status_check;
alter table public.payments
  add constraint payments_provider_status_check
  check (provider_status in ('not_connected', 'pending', 'confirmed', 'failed', 'refunded', 'disputed'));

create or replace function public.record_stripe_refund(
  p_payment_intent_id text,
  p_charge_id text default null,
  p_amount_refunded integer default null,
  p_fully_refunded boolean default false
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_pay record;
  v_owner uuid;
begin
  select p.id, p.application_id, p.structure_id into v_pay
  from public.payments p
  where (p_payment_intent_id is not null and p.stripe_payment_intent_id = p_payment_intent_id)
     or (p_charge_id is not null and p.stripe_charge_id = p_charge_id)
  limit 1;

  if not found then
    -- Remboursement avant libération : seule la référence candidature est marquée.
    if p_fully_refunded and p_payment_intent_id is not null then
      update public.applications
      set stripe_payment_status = 'refunded'
      where stripe_payment_intent_id = p_payment_intent_id;
    end if;
    return null;
  end if;

  update public.payments
  set provider_status = case when p_fully_refunded then 'refunded' else provider_status end,
      internal_status = case when p_fully_refunded then 'refunded' else internal_status end,
      breakdown = coalesce(breakdown, '{}'::jsonb) || jsonb_build_object(
        'stripe_refund', jsonb_build_object(
          'amount_refunded_cents', p_amount_refunded,
          'fully_refunded', p_fully_refunded,
          'charge_id', p_charge_id,
          'recorded_at', now()
        )
      )
  where id = v_pay.id;

  select owner_id into v_owner from public.structures where id = v_pay.structure_id;
  if v_owner is not null then
    perform public.notify(
      v_owner, 'payment',
      'Remboursement Stripe enregistré',
      'Un remboursement de ' || to_char(coalesce(p_amount_refunded, 0) / 100.0, 'FM999990.00')
        || ' € a été enregistré sur le paiement de la mission'
        || case when p_fully_refunded then ' (remboursement total).' else ' (remboursement partiel).' end,
      jsonb_build_object(
        'payment_id', v_pay.id,
        'application_id', v_pay.application_id,
        'amount_refunded_cents', p_amount_refunded,
        'fully_refunded', p_fully_refunded
      )
    );
  end if;

  return v_pay.id;
end;
$$;

create or replace function public.record_stripe_dispute(
  p_dispute_id text,
  p_payment_intent_id text default null,
  p_charge_id text default null,
  p_amount integer default null,
  p_reason text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_pay record;
  v_owner uuid;
begin
  -- Référence candidature (existe même si le paiement n'est pas encore libéré).
  if p_payment_intent_id is not null then
    update public.applications
    set stripe_payment_status = 'disputed'
    where stripe_payment_intent_id = p_payment_intent_id;
  end if;

  select p.id, p.application_id, p.structure_id into v_pay
  from public.payments p
  where (p_payment_intent_id is not null and p.stripe_payment_intent_id = p_payment_intent_id)
     or (p_charge_id is not null and p.stripe_charge_id = p_charge_id)
  limit 1;

  if found then
    update public.payments
    set provider_status = 'disputed',
        breakdown = coalesce(breakdown, '{}'::jsonb) || jsonb_build_object(
          'stripe_dispute', jsonb_build_object(
            'dispute_id', p_dispute_id,
            'amount_cents', p_amount,
            'reason', p_reason,
            'recorded_at', now()
          )
        )
    where id = v_pay.id;
    select owner_id into v_owner from public.structures where id = v_pay.structure_id;
  else
    -- Paiement non libéré : retrouve la structure via la candidature.
    select s.owner_id into v_owner
    from public.applications a
    join public.missions m on m.id = a.mission_id
    join public.structures s on s.id = m.structure_id
    where a.stripe_payment_intent_id = p_payment_intent_id
    limit 1;
  end if;

  if v_owner is not null then
    perform public.notify(
      v_owner, 'payment',
      'Litige de paiement ouvert ⚠️',
      'Un litige (' || coalesce(p_reason, 'raison inconnue') || ') de '
        || to_char(coalesce(p_amount, 0) / 100.0, 'FM999990.00')
        || ' € a été ouvert sur un paiement de mission. L''équipe UROSI va instruire le dossier.',
      jsonb_build_object(
        'dispute_id', p_dispute_id,
        'payment_id', (select v_pay.id),
        'payment_intent_id', p_payment_intent_id,
        'amount_cents', p_amount,
        'reason', p_reason
      )
    );
  end if;

  return (select v_pay.id);
end;
$$;

revoke execute on function public.record_stripe_refund(text, text, integer, boolean) from public, anon, authenticated;
revoke execute on function public.record_stripe_dispute(text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_stripe_refund(text, text, integer, boolean) to service_role;
grant execute on function public.record_stripe_dispute(text, text, text, integer, text) to service_role;

notify pgrst, 'reload schema';
