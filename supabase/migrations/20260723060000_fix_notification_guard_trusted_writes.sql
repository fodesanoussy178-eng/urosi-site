-- Corrige un bug reel trouve en testant la resolution KYC de bout en bout :
-- private.guard_notification_update() ne laissait passer les colonnes
-- protegees (is_critical, resolved_at...) que pour un appelant service_role.
-- Or trg_notify_kyc_status, record_stripe_refund et
-- founder_resolve_notification s'executent tous sous la session JWT normale
-- de l'utilisateur (fondateur ou webhook authentifie), jamais litteralement
-- en service_role : le garde annulait donc silencieusement toute resolution
-- legitime (resolved_at repassait a NULL juste apres avoir ete pose).
--
-- Remplace le test par un drapeau de transaction explicite
-- (app.notifications_trusted_write), positionne uniquement par le code
-- serveur qui a le droit de toucher ces colonnes. Un client qui poserait ce
-- meme GUC depuis une requete SQL directe n'y a pas acces : seules les
-- fonctions SECURITY DEFINER ci-dessous peuvent l'activer.

create or replace function private.guard_notification_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(current_setting('app.notifications_trusted_write', true), '') <> 'true' then
    new.profile_id := old.profile_id;
    new.kind := old.kind;
    new.title := old.title;
    new.body := old.body;
    new.data := old.data;
    new.is_critical := old.is_critical;
    new.resolved_at := old.resolved_at;
    new.created_at := old.created_at;
    if old.is_critical and old.resolved_at is null then
      new.deleted_at := null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.trg_notify_kyc_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.kyc_status = old.kyc_status then
    return new;
  end if;

  if new.kyc_status = 'rejected' then
    perform public.notify(
      new.id, 'kyc_rejected', 'Document KYC refusé',
      coalesce(nullif(current_setting('app.kyc_reason', true), ''), 'Ton document d''identité a été refusé. Consulte le motif et soumets un nouveau document.'),
      jsonb_build_object('profile_id', new.id),
      true
    );
  elsif new.kyc_status = 'verified' then
    perform set_config('app.notifications_trusted_write', 'true', true);
    update public.notifications
    set resolved_at = now()
    where profile_id = new.id and kind = 'kyc_rejected' and resolved_at is null;
  end if;

  return new;
end;
$$;

create or replace function public.founder_resolve_notification(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform private.assert_founder();
  perform set_config('app.notifications_trusted_write', 'true', true);
  update public.notifications set resolved_at = now() where id = p_id and resolved_at is null;
end;
$$;

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

  if p_fully_refunded then
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
