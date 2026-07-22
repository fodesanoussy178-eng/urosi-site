-- Cohérence des statuts : un paiement Stripe libéré est released/confirmed.
-- (record_stripe_mission_payment laissait les défauts pending/not_connected.)
update public.payments
set internal_status = 'released', provider_status = 'confirmed'
where provider = 'stripe' and status = 'released' and internal_status = 'pending';

create or replace function public.record_stripe_mission_payment(
  p_application_id uuid,
  p_payment_intent_id text,
  p_charge_id text default null,
  p_transfer_id text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_app record;
  v_pct numeric;
  v_commission integer;
  v_bonus integer;
  v_payment_id uuid;
begin
  select a.id, a.status, a.worker_id,
         m.id as mission_id, m.title, m.worker_rate_cents, m.base_rate_cents,
         m.is_solidaire, m.pricing_breakdown, m.structure_id,
         s.owner_id, s.name as structure_name
  into v_app
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = p_application_id
  for update of a;

  if not found then
    raise exception 'Candidature introuvable.';
  end if;
  if v_app.status not in ('payment_pending', 'completed') then
    raise exception 'La mission doit être en attente de paiement (statut : %).', v_app.status;
  end if;
  if v_app.is_solidaire or v_app.worker_rate_cents <= 0 then
    return null;
  end if;

  select id into v_payment_id from public.payments where application_id = p_application_id;
  if v_payment_id is not null then
    return v_payment_id;
  end if;

  select commission_pct into v_pct from public.platform_settings where id = true;
  v_commission := round(v_app.worker_rate_cents * coalesce(v_pct, 18) / 100.0)::int;
  v_bonus := greatest(v_app.worker_rate_cents - coalesce(v_app.base_rate_cents, v_app.worker_rate_cents), 0);

  insert into public.payments (
    application_id, amount_cents, status, internal_status, provider_status,
    structure_id, worker_id,
    worker_amount_cents, commission_cents, bonus_cents, provider, released_at,
    breakdown, stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id
  ) values (
    p_application_id, v_app.worker_rate_cents + v_commission, 'released',
    'released', 'confirmed',
    v_app.structure_id, v_app.worker_id,
    v_app.worker_rate_cents, v_commission, v_bonus, 'stripe', now(),
    v_app.pricing_breakdown, p_payment_intent_id, p_charge_id, p_transfer_id
  )
  returning id into v_payment_id;

  update public.applications
  set status = 'completed'
  where id = p_application_id
    and status = 'payment_pending';

  perform public.notify(
    v_app.worker_id, 'payment',
    'Paiement envoyé 💶',
    'Ton virement Stripe de ' || to_char(v_app.worker_rate_cents / 100.0, 'FM999990.00')
      || ' € est en route pour « ' || v_app.title || ' ».',
    jsonb_build_object(
      'application_id', p_application_id,
      'payment_id', v_payment_id,
      'amount_cents', v_app.worker_rate_cents,
      'provider', 'stripe',
      'transfer_id', p_transfer_id
    )
  );

  return v_payment_id;
end;
$$;

revoke execute on function public.record_stripe_mission_payment(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_stripe_mission_payment(uuid, text, text, text) to service_role;
notify pgrst, 'reload schema';
