// Edge Function `authorize-missions` — Module 2 (empreinte bancaire structure), MODE TEST.
//
// Cron horaire : pose l'autorisation bancaire (hold) sur les missions qui en
// ont besoin, via un PaymentIntent Stripe en capture manuelle (capture_method
// 'manual', confirm off_session sur le moyen de paiement par défaut de la
// structure). Aucun débit réel ici : seule capture-missions débite le montant
// réellement dû à J+3.
//
// Sans cette fonction, missions_due_for_authorization() ne renvoie jamais
// personne côté capture : le schéma et les RPC du Module 2 existent en base
// mais aucune autorisation n'est jamais posée.
//
// Accès réservé au backend : même convention que release-due-payments
// (clé service_role OU STRIPE_CRON_SECRET dédié, via isAuthorizedCron).
// Planifier via Supabase Scheduled Function ou pg_cron + pg_net, cadence horaire.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { stripe, assertTestMode, assertNotLive, isAuthorizedCron, serviceClient } from "../_shared/stripe.ts";

interface DueRow {
  mission_id: string;
  structure_id: string;
  owner_id: string;
  stripe_customer_id: string | null;
  stripe_default_payment_method_id: string | null;
  amount_cents: number;
  attempts: number;
}

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json" };
  const startedAt = new Date().toISOString();

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée." }), { status: 405, headers });
  }

  if (!isAuthorizedCron(req.headers.get("Authorization"))) {
    return new Response(JSON.stringify({ error: "Accès réservé au backend UROSI." }), { status: 401, headers });
  }

  try {
    assertTestMode();
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 403, headers });
  }

  const supabase = serviceClient();

  const { data: due, error: dueError } = await supabase.rpc("missions_due_for_authorization", {
    p_limit: 100,
  });
  if (dueError) {
    return new Response(JSON.stringify({ error: dueError.message }), { status: 500, headers });
  }

  let authorized = 0;
  let requiresAction = 0;
  let failed = 0;
  let totalAmountCents = 0;

  for (const m of (due ?? []) as DueRow[]) {
    try {
      if (!m.stripe_customer_id || !m.stripe_default_payment_method_id) {
        await supabase.rpc("record_mission_authorization_failure", {
          p_mission_id: m.mission_id,
          p_reason: "missing_payment_method",
        });
        failed++;
        continue;
      }

      const intent = await stripe.paymentIntents.create(
        {
          amount: m.amount_cents,
          currency: "eur",
          customer: m.stripe_customer_id,
          payment_method: m.stripe_default_payment_method_id,
          capture_method: "manual",
          confirm: true,
          off_session: true,
          metadata: { mission_id: m.mission_id, structure_id: m.structure_id },
        },
        { idempotencyKey: `authorize_mission_${m.mission_id}` },
      );
      assertNotLive(intent.livemode);

      if (intent.status === "requires_action") {
        await supabase.rpc("record_mission_authorization_requires_action", {
          p_mission_id: m.mission_id,
          p_stripe_payment_intent_id: intent.id,
        });
        requiresAction++;
      } else if (intent.status === "requires_capture" || intent.status === "succeeded") {
        await supabase.rpc("record_mission_authorization", {
          p_mission_id: m.mission_id,
          p_stripe_payment_intent_id: intent.id,
          p_amount_cents: m.amount_cents,
        });
        authorized++;
        totalAmountCents += m.amount_cents;
      } else {
        await supabase.rpc("record_mission_authorization_failure", {
          p_mission_id: m.mission_id,
          p_reason: `unexpected_status_${intent.status}`,
        });
        failed++;
      }
    } catch (err) {
      await supabase.rpc("record_mission_authorization_failure", {
        p_mission_id: m.mission_id,
        p_reason: (err as Error).message ?? "stripe_error",
      });
      failed++;
    }
  }

  const { data: cancelled, error: cancelError } = await supabase.rpc("auto_cancel_unfunded_missions");
  if (cancelError) {
    console.error("auto_cancel_unfunded_missions", cancelError);
  }

  await supabase.rpc("record_cron_execution", {
    p_job_name: "authorize_missions",
    p_started_at: startedAt,
    p_checked: (due ?? []).length,
    p_released: authorized,
    p_skipped: requiresAction,
    p_failed: failed,
    p_total_amount_cents: totalAmountCents,
  });

  return new Response(
    JSON.stringify({
      checked: (due ?? []).length,
      authorized,
      requires_action: requiresAction,
      failed,
      auto_cancelled: (cancelled ?? []).length,
    }),
    { status: 200, headers },
  );
});
