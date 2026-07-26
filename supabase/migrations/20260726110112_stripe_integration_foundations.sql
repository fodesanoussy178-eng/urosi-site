-- Fondations de l'intégration Stripe (Connect, Identity, Radar) — MODE TEST.
--
-- Additive uniquement : nouvelles colonnes, table d'idempotence webhook et
-- RPC `security definer` réservées au backend (Edge Functions en service_role).
-- Aucune logique financière existante n'est modifiée.
--
-- Rappel sécurité : private.guard_simulated_payment ne bloque QUE
-- provider='internal'. Les paiements réels portent provider='stripe' et
-- passent donc le garde sans qu'il faille l'affaiblir.
--
-- Modèle : « charges et transferts séparés ».
--   1. La structure paie un PaymentIntent (fonds sur la plateforme).
--   2. À J+3, release-due-payments crée un Transfer vers le compte connecté
--      Express du travailleur ; la plateforme conserve la commission.
--   3. La table `payments` (provider='stripe') est l'enregistrement de
--      référence. Le solde travailleur affiché doit être lu depuis Stripe
--      (Edge Function stripe-connect-balance), l'ancien wallet interne étant
--      la simulation d'avant-PSP.

-- ---------------------------------------------------------------------------
-- Colonnes Connect / Identity sur les profils travailleurs
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists stripe_account_id text;
alter table public.profiles add column if not exists stripe_charges_enabled boolean not null default false;
alter table public.profiles add column if not exists stripe_payouts_enabled boolean not null default false;
alter table public.profiles add column if not exists stripe_identity_session_id text;
alter table public.profiles add column if not exists stripe_identity_status text not null default 'unverified';
alter table public.profiles drop constraint if exists profiles_stripe_identity_status_check;
alter table public.profiles
  add constraint profiles_stripe_identity_status_check
  check (stripe_identity_status in (
    'unverified', 'pending', 'processing', 'verified', 'requires_input', 'canceled'
  ));

create unique index if not exists profiles_stripe_account_id_key
  on public.profiles (stripe_account_id)
  where stripe_account_id is not null;

-- ---------------------------------------------------------------------------
-- Customer Stripe côté structure (payeur)
-- ---------------------------------------------------------------------------
alter table public.structures add column if not exists stripe_customer_id text;
create unique index if not exists structures_stripe_customer_id_key
  on public.structures (stripe_customer_id)
  where stripe_customer_id is not null;

-- ---------------------------------------------------------------------------
-- Références Stripe sur payments et applications
-- ---------------------------------------------------------------------------
alter table public.payments add column if not exists stripe_payment_intent_id text;
alter table public.payments add column if not exists stripe_charge_id text;
alter table public.payments add column if not exists stripe_transfer_id text;
create index if not exists payments_stripe_payment_intent_idx
  on public.payments (stripe_payment_intent_id);

-- Le PaymentIntent de provisionnement est rattaché à la candidature dès que la
-- structure paie ; sa charge sert de source_transaction au Transfer J+3.
alter table public.applications add column if not exists stripe_payment_intent_id text;
alter table public.applications add column if not exists stripe_charge_id text;
alter table public.applications add column if not exists stripe_payment_status text;

-- ---------------------------------------------------------------------------
-- Idempotence des webhooks Stripe (un event traité une seule fois)
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_webhook_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_webhook_events enable row level security;
-- Aucune policy : seul le service_role (bypass RLS) y accède.

-- ---------------------------------------------------------------------------
-- RPC réservées au backend. Toutes en security definer, révoquées du public
-- puis accordées explicitement au service_role (appelées par les Edge
-- Functions Stripe). Les données Stripe restent hors de portée des clients.
-- ---------------------------------------------------------------------------

-- Enregistre l'id de compte Express d'un travailleur.
create or replace function public.set_worker_stripe_account(
  p_profile_id uuid,
  p_account_id text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles
  set stripe_account_id = p_account_id
  where id = p_profile_id;
end;
$$;

-- Met à jour les capacités (charges/payouts) reçues via account.updated.
create or replace function public.set_worker_stripe_capabilities(
  p_account_id text,
  p_charges_enabled boolean,
  p_payouts_enabled boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles
  set stripe_charges_enabled = coalesce(p_charges_enabled, false),
      stripe_payouts_enabled = coalesce(p_payouts_enabled, false)
  where stripe_account_id = p_account_id;
end;
$$;

-- Statut Stripe Identity (démarrage, puis événements du webhook).
create or replace function public.set_worker_identity_status(
  p_profile_id uuid,
  p_status text,
  p_session_id text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_status not in (
    'unverified', 'pending', 'processing', 'verified', 'requires_input', 'canceled'
  ) then
    raise exception 'Statut Identity invalide : %', p_status;
  end if;
  update public.profiles
  set stripe_identity_status = p_status,
      stripe_identity_session_id = coalesce(p_session_id, stripe_identity_session_id)
  where id = p_profile_id;
end;
$$;

-- Enregistre le Customer Stripe d'une structure.
create or replace function public.set_structure_stripe_customer(
  p_structure_id uuid,
  p_customer_id text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.structures
  set stripe_customer_id = p_customer_id
  where id = p_structure_id;
end;
$$;

-- Rattache le PaymentIntent de provisionnement à la candidature.
create or replace function public.attach_mission_payment_intent(
  p_application_id uuid,
  p_payment_intent_id text,
  p_status text default null,
  p_charge_id text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.applications
  set stripe_payment_intent_id = p_payment_intent_id,
      stripe_payment_status = coalesce(p_status, stripe_payment_status),
      stripe_charge_id = coalesce(p_charge_id, stripe_charge_id)
  where id = p_application_id;
end;
$$;

-- Idempotence : renvoie true si l'event est nouveau (donc à traiter).
create or replace function public.mark_stripe_webhook_event(
  p_id text,
  p_type text
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_inserted integer;
begin
  insert into public.stripe_webhook_events (id, type)
  values (p_id, p_type)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

-- Enregistrement de référence d'un paiement de mission réglé via Stripe,
-- après création du Transfer vers le travailleur. Idempotent (index unique
-- payments.application_id). Passe la candidature en `completed` : le trigger
-- trg_pay_on_completion appellera process_mission_payment, qui trouvera ce
-- paiement déjà présent et sortira immédiatement (aucun paiement 'internal').
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
    return null; -- mission solidaire : aucun flux financier
  end if;

  -- Idempotence : déjà enregistré ?
  select id into v_payment_id from public.payments where application_id = p_application_id;
  if v_payment_id is not null then
    return v_payment_id;
  end if;

  select commission_pct into v_pct from public.platform_settings where id = true;
  v_commission := round(v_app.worker_rate_cents * coalesce(v_pct, 15) / 100.0)::int;
  v_bonus := greatest(v_app.worker_rate_cents - coalesce(v_app.base_rate_cents, v_app.worker_rate_cents), 0);

  insert into public.payments (
    application_id, amount_cents, status, structure_id, worker_id,
    worker_amount_cents, commission_cents, bonus_cents, provider, released_at,
    breakdown, stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id
  ) values (
    p_application_id, v_app.worker_rate_cents + v_commission, 'released',
    v_app.structure_id, v_app.worker_id,
    v_app.worker_rate_cents, v_commission, v_bonus, 'stripe', now(),
    v_app.pricing_breakdown, p_payment_intent_id, p_charge_id, p_transfer_id
  )
  returning id into v_payment_id;

  -- Passage en completed (service_role autorisé par le garde de transition).
  -- Le trigger de paiement trouvera le paiement ci-dessus et sortira.
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

-- Révocations + grants explicites au backend.
revoke execute on function public.set_worker_stripe_account(uuid, text) from public, anon, authenticated;
revoke execute on function public.set_worker_stripe_capabilities(text, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.set_worker_identity_status(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.set_structure_stripe_customer(uuid, text) from public, anon, authenticated;
revoke execute on function public.attach_mission_payment_intent(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.mark_stripe_webhook_event(text, text) from public, anon, authenticated;
revoke execute on function public.record_stripe_mission_payment(uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.set_worker_stripe_account(uuid, text) to service_role;
grant execute on function public.set_worker_stripe_capabilities(text, boolean, boolean) to service_role;
grant execute on function public.set_worker_identity_status(uuid, text, text) to service_role;
grant execute on function public.set_structure_stripe_customer(uuid, text) to service_role;
grant execute on function public.attach_mission_payment_intent(uuid, text, text, text) to service_role;
grant execute on function public.mark_stripe_webhook_event(text, text) to service_role;
grant execute on function public.record_stripe_mission_payment(uuid, text, text, text) to service_role;
