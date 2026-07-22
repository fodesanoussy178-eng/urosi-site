// Edge Function `release-due-payments` — libération J+3 via Stripe (MODE TEST).
//
// Sélectionne les candidatures `payment_pending` dont `payment_ready_at` est
// échu, crée un **Transfer** Stripe vers le compte connecté Express du
// travailleur (modèle « charges et transferts séparés »), puis enregistre le
// paiement de référence via record_stripe_mission_payment (provider='stripe',
// passage en `completed`). La plateforme conserve la commission.
//
// Une candidature est ignorée (laissée en payment_pending) si :
//   - le travailleur n'a pas de compte Stripe / payouts non activés ;
//   - l'identité n'est pas vérifiée ;
//   - le PaymentIntent de provisionnement de la structure n'a pas réussi.
//
// Accès réservé au backend : l'appelant présente la clé service_role.
// Planifier via Supabase Scheduled Function ou pg_cron + pg_net.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { stripe, assertTestMode, assertNotLive, isAuthorizedCron } from "../_shared/stripe.ts";

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json" };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée." }), { status: 405, headers });
  }

  // Accès réservé au backend : clé service_role OU STRIPE_CRON_SECRET dédié.
  if (!isAuthorizedCron(req.headers.get("Authorization"), Deno.env.toObject())) {
    return new Response(JSON.stringify({ error: "Accès réservé au backend UROSI." }), { status: 401, headers });
  }

  // Aucune libération ne part avec une clé live tant que le mode test est actif.
  try {
    assertTestMode();
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 403, headers });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: due, error: selectError } = await supabase
    .from("applications")
    .select(
      "id, worker_id, stripe_payment_intent_id, stripe_charge_id, stripe_payment_status, " +
        "missions!inner(worker_rate_cents, is_solidaire), " +
        "profiles!applications_worker_id_fkey(stripe_account_id, stripe_payouts_enabled, stripe_identity_status)",
    )
    .eq("status", "payment_pending")
    .lte("payment_ready_at", new Date().toISOString())
    .limit(100);

  if (selectError) {
    return new Response(JSON.stringify({ error: selectError.message }), { status: 500, headers });
  }

  interface DueRow {
    id: string;
    worker_id: string;
    stripe_payment_intent_id: string | null;
    stripe_charge_id: string | null;
    stripe_payment_status: string | null;
    missions: { worker_rate_cents: number; is_solidaire: boolean };
    profiles:
      | { stripe_account_id: string | null; stripe_payouts_enabled: boolean; stripe_identity_status: string }
      | null;
  }

  const released: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const a of (due ?? []) as unknown as DueRow[]) {
    const mission = a.missions;
    const worker = a.profiles;

    try {
      if (mission.is_solidaire || mission.worker_rate_cents <= 0) {
        skipped.push({ id: a.id, reason: "mission_solidaire" });
        continue;
      }
      if (!worker?.stripe_account_id || !worker.stripe_payouts_enabled) {
        skipped.push({ id: a.id, reason: "worker_not_onboarded" });
        continue;
      }
      if (worker.stripe_identity_status !== "verified") {
        skipped.push({ id: a.id, reason: "identity_not_verified" });
        continue;
      }
      if (!a.stripe_payment_intent_id) {
        skipped.push({ id: a.id, reason: "no_payment_intent" });
        continue;
      }

      // Charge source (lie la disponibilité du transfert au paiement structure).
      let chargeId: string | null = a.stripe_charge_id ?? null;
      if (!chargeId) {
        const pi = await stripe.paymentIntents.retrieve(a.stripe_payment_intent_id);
        assertNotLive(pi.livemode);
        if (pi.status !== "succeeded") {
          skipped.push({ id: a.id, reason: `payment_${pi.status}` });
          continue;
        }
        chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : null;
      }

      const transfer = await stripe.transfers.create(
        {
          amount: mission.worker_rate_cents,
          currency: "eur",
          destination: worker.stripe_account_id,
          transfer_group: `mission_${a.id}`,
          ...(chargeId ? { source_transaction: chargeId } : {}),
          metadata: { application_id: a.id, worker_id: a.worker_id },
        },
        { idempotencyKey: `transfer_mission_${a.id}` },
      );
      assertNotLive(transfer.livemode);

      const { error: recordErr } = await supabase.rpc("record_stripe_mission_payment", {
        p_application_id: a.id,
        p_payment_intent_id: a.stripe_payment_intent_id,
        p_charge_id: chargeId,
        p_transfer_id: transfer.id,
      });
      if (recordErr) throw recordErr;

      released.push(a.id);
    } catch (err) {
      failed.push({ id: a.id, error: (err as Error).message });
    }
  }

  return new Response(
    JSON.stringify({ checked: (due ?? []).length, released, skipped, failed }),
    { status: 200, headers },
  );
});
