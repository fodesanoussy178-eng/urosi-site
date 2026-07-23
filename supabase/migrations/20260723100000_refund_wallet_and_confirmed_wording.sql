-- Document 2 — deux ajustements du flux paiement :
--
-- 1) Remboursement Stripe -> Wallet cohérent. Sur un remboursement TOTAL, le
--    Wallet est ramené à son état d'avant-mission : le gain encore « en
--    attente » (jamais versé) est retiré, et tout mouvement déjà « disponible »
--    (gain versé, charge structure, commission) est contre-passé. La
--    candidature repasse à stripe_payment_status='refunded'. Idempotent : ne
--    s'exécute qu'une fois. Les remboursements partiels restent seulement
--    enregistrés (aucune écriture Wallet automatique).
--
--    L'encaissement Checkout de la structure est porté par la CANDIDATURE
--    (colonnes stripe_*), pas par la table payments (alimentée seulement en fin
--    de mission) : on retrouve donc la candidature par ses identifiants Stripe,
--    et la contre-passation fonctionne qu'une ligne payments existe ou non.
--
-- 2) Notification travailleur « Mission confirmée » au moment où Stripe
--    confirme le paiement (candidature payée -> acceptée), au lieu de
--    « Candidature acceptée ». Le direct-accept d'une mission solidaire/gratuite
--    conserve « Candidature acceptée 🎉 ».

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
  v_app record;
  v_owner uuid;
  v_prev_status text;
  v_first_full boolean := false;
  v_had_earning boolean := false;
begin
  select a.id as application_id, a.worker_id, a.stripe_payment_status, m.title, s.owner_id
  into v_app
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where (p_payment_intent_id is not null and a.stripe_payment_intent_id = p_payment_intent_id)
     or (p_charge_id is not null and a.stripe_charge_id = p_charge_id)
  limit 1;

  select p.id, p.application_id, p.structure_id into v_pay
  from public.payments p
  where (p_payment_intent_id is not null and p.stripe_payment_intent_id = p_payment_intent_id)
     or (p_charge_id is not null and p.stripe_charge_id = p_charge_id)
  limit 1;

  if v_app.application_id is null and v_pay.id is null then
    return null;
  end if;

  -- Premier remboursement TOTAL sur cette candidature : conditionne toutes les
  -- écritures « une seule fois » (Wallet, notifications), pour l'idempotence.
  v_first_full := p_fully_refunded and v_app.application_id is not null
    and coalesce(v_app.stripe_payment_status, '') <> 'refunded';

  if v_pay.id is not null then
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
  end if;

  -- Notifie la structure une fois : à chaque remboursement partiel distinct, ou
  -- au premier remboursement total (jamais sur un rejeu de remboursement total).
  v_owner := coalesce(v_app.owner_id, (select owner_id from public.structures where id = v_pay.structure_id));
  if v_owner is not null and (not p_fully_refunded or v_first_full) then
    perform public.notify(
      v_owner, 'payment',
      'Remboursement Stripe enregistré',
      'Un remboursement de ' || to_char(coalesce(p_amount_refunded, 0) / 100.0, 'FM999990.00')
        || ' € a été enregistré sur le paiement de la mission'
        || case when p_fully_refunded then ' (remboursement total).' else ' (remboursement partiel).' end,
      jsonb_build_object(
        'payment_id', v_pay.id,
        'application_id', coalesce(v_app.application_id, v_pay.application_id),
        'amount_refunded_cents', p_amount_refunded,
        'fully_refunded', p_fully_refunded
      )
    );
  end if;

  if v_first_full then
    update public.applications
    set stripe_payment_status = 'refunded'
    where id = v_app.application_id;

    select exists (
      select 1 from public.wallet_transactions
      where application_id = v_app.application_id and kind = 'mission_earning'
    ) into v_had_earning;

    delete from public.wallet_transactions
    where application_id = v_app.application_id
      and kind = 'mission_earning'
      and fund_status = 'pending';

    insert into public.wallet_transactions (
      wallet_id, amount_cents, kind, application_id, label, fund_status
    )
    select t.wallet_id, -t.amount_cents, 'adjustment', v_app.application_id,
           'Contre-passation remboursement Stripe', 'available'
    from public.wallet_transactions t
    where t.application_id = v_app.application_id
      and t.fund_status = 'available'
      and t.kind in ('mission_earning', 'mission_charge', 'commission');

    if v_had_earning and v_app.worker_id is not null then
      perform public.notify(
        v_app.worker_id, 'payment', 'Mission remboursée',
        'Le paiement de cette mission a été remboursé à la structure. Ton Wallet a été mis à jour en conséquence.',
        jsonb_build_object('application_id', v_app.application_id, 'fully_refunded', true)
      );
    end if;
  end if;

  if p_fully_refunded and v_pay.id is not null then
    perform set_config('app.notifications_trusted_write', 'true', true);
    update public.notifications
    set resolved_at = now()
    where kind = 'payment'
      and resolved_at is null
      and is_critical
      and data ->> 'payment_id' = v_pay.id::text;
  end if;

  return v_pay.id;
end;
$$;

create or replace function public.trg_notify_application_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
begin
  if new.status = old.status then
    return new;
  end if;

  select s.owner_id, m.title into v_owner, v_title
  from public.missions m
  join public.structures s on s.id = m.structure_id
  where m.id = new.mission_id;

  if new.status = 'accepted' then
    if coalesce(new.stripe_payment_status, '') = 'paid' then
      perform public.notify(
        new.worker_id, 'application_accepted',
        'Mission confirmée ✅',
        'Le paiement est confirmé : « ' || v_title || ' » est confirmée. Le fil de discussion est ouvert.',
        jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
      );
    else
      perform public.notify(
        new.worker_id, 'application_accepted',
        'Candidature acceptée 🎉',
        'Tu es retenu·e pour « ' || v_title || ' ». Le fil de discussion est ouvert.',
        jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
      );
    end if;
  elsif new.status = 'rejected' then
    perform public.notify(
      new.worker_id, 'application_rejected',
      'Candidature non retenue',
      'La structure a choisi un autre profil pour « ' || v_title || ' ».',
      jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
    );
  elsif new.status = 'completed' then
    perform public.notify(
      v_owner, 'mission_completed',
      'Mission terminée',
      '« ' || v_title || ' » est marquée terminée. Pense à noter le travailleur.',
      jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
    );
  elsif new.status = 'cancelled' then
    if auth.uid() = new.worker_id then
      perform public.notify(
        v_owner, 'application_cancelled',
        'Candidature annulée',
        'Un travailleur s''est désisté sur « ' || v_title || ' ».',
        jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
      );
    else
      perform public.notify(
        new.worker_id, 'mission_cancelled_by_structure',
        'Mission annulée',
        'La structure a annulé « ' || v_title || ' ». Aucune sanction de ton côté.',
        jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
      );
    end if;
  end if;
  return new;
end;
$$;
