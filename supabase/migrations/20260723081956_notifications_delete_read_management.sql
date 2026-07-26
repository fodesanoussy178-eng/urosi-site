-- Gestion reelle des notifications : suppression individuelle (soft delete),
-- suppression totale, lecture individuelle/totale, et protection des
-- notifications critiques (litige, paiement, KYC) tant qu'elles ne sont pas
-- resolues. Identique cote travailleur et structure : tout repose sur
-- profile_id, deja scope par utilisateur quel que soit son role.

-- ---------------------------------------------------------------------------
-- 1. Colonnes. read_at (deja present) fait deja office de is_read ; pas de
--    colonne booleenne redondante.
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists deleted_at timestamptz;
alter table public.notifications add column if not exists archived_at timestamptz;
alter table public.notifications add column if not exists is_critical boolean not null default false;
alter table public.notifications add column if not exists resolved_at timestamptz;

create index if not exists notifications_profile_active_idx
  on public.notifications (profile_id, created_at desc)
  where deleted_at is null;
create index if not exists notifications_profile_critical_idx
  on public.notifications (profile_id, created_at desc)
  where is_critical and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. notify() : parametre optionnel pour marquer une notification critique
--    (litige, paiement echoue, KYC refuse, action administrative obligatoire).
-- ---------------------------------------------------------------------------
create or replace function public.notify(
  p_profile_id uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_data jsonb default '{}'::jsonb,
  p_critical boolean default false
)
returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (profile_id, kind, title, body, data, is_critical)
  values (p_profile_id, p_kind, p_title, p_body, coalesce(p_data, '{}'::jsonb), coalesce(p_critical, false));
$$;

revoke execute on function public.notify(uuid, text, text, text, jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Garde : un utilisateur ne peut modifier que read_at/deleted_at/archived_at
--    de ses propres notifications ; jamais is_critical/resolved_at/kind/etc,
--    et jamais deleted_at sur une notification critique non resolue (elle ne
--    peut alors qu'etre archivee, pas supprimee).
-- ---------------------------------------------------------------------------
create or replace function private.guard_notification_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
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

drop trigger if exists notifications_guard_update on public.notifications;
create trigger notifications_guard_update
  before update on public.notifications
  for each row execute function private.guard_notification_update();

-- Toujours pas de policy INSERT (uniquement via notify(), security definer)
-- ni de policy DELETE (soft delete uniquement, jamais de suppression dure
-- depuis le client).
drop policy if exists "notifications: mark own read" on public.notifications;
create policy "notifications: update own"
  on public.notifications for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Suppression totale : soft delete de tout ce qui peut l'etre, laisse en
--    place les notifications critiques non resolues (le trigger de garde les
--    protege de toute facon, mais on evite l'ecriture inutile ici).
-- ---------------------------------------------------------------------------
create or replace function public.delete_all_notifications()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_deleted integer;
  v_kept integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Connexion requise.';
  end if;

  update public.notifications
  set deleted_at = now()
  where profile_id = auth.uid()
    and deleted_at is null
    and not (is_critical and resolved_at is null);
  get diagnostics v_deleted = row_count;

  select count(*) into v_kept
  from public.notifications
  where profile_id = auth.uid()
    and deleted_at is null
    and is_critical
    and resolved_at is null;

  return jsonb_build_object('deleted', v_deleted, 'kept_protected', v_kept);
end;
$$;

revoke execute on function public.delete_all_notifications() from public, anon;
grant execute on function public.delete_all_notifications() to authenticated;

-- Support/fondateur : debloque manuellement une notification critique restee
-- sans resolution automatisee (ex. litige Stripe sans webhook de cloture
-- cable aujourd'hui) afin que l'utilisateur puisse enfin la supprimer.
create or replace function public.founder_resolve_notification(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform private.assert_founder();
  update public.notifications set resolved_at = now() where id = p_id and resolved_at is null;
end;
$$;

revoke execute on function public.founder_resolve_notification(uuid) from public, anon, authenticated;
grant execute on function public.founder_resolve_notification(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Notifications KYC (absentes jusqu'ici) : refus marque critique, la
--    verification ulterieure resout automatiquement le refus precedent.
-- ---------------------------------------------------------------------------
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
    update public.notifications
    set resolved_at = now()
    where profile_id = new.id and kind = 'kyc_rejected' and resolved_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_notify_kyc_status on public.profiles;
create trigger profiles_notify_kyc_status
  after update of kyc_status on public.profiles
  for each row execute function public.trg_notify_kyc_status();

-- ---------------------------------------------------------------------------
-- 6. Litiges de paiement Stripe : deja notifies (record_stripe_dispute),
--    marques critiques desormais. Un remboursement total ou un refus definitif
--    resout le litige ; sinon founder_resolve_notification reste le recours
--    (pas de webhook "dispute.closed" cable aujourd'hui).
-- ---------------------------------------------------------------------------
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
      ),
      true
    );
  end if;

  return (select v_pay.id);
end;
$$;

-- Un remboursement total ferme de fait le litige ouvert sur ce paiement.
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
