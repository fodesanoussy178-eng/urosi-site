// Edge Function `capture-missions` — Module 2 (empreinte bancaire structure), MODE TEST.
//
// Cron horaire : règle le sort de chaque autorisation bancaire posée par
// authorize-missions une fois la mission jouée. Si rien n'est réellement dû
// au travailleur (mission_id sans réalisé), l'autorisation est annulée sans
// débit ; sinon on capture uniquement le montant réellement dû + la
// commission plateforme, jamais plus que ce qui a été autorisé.
//
// Sans cette fonction, une autorisation posée par authorize-missions ne
// serait jamais ni capturée ni relâchée, et resterait bloquée indéfiniment
// sur la carte de la structure.
//
// Accès réservé au backend : même convention que release-due-payments
// (clé service_role OU STRIPE_CRON_SECRET dédié, via isAuthorizedCron).
// Planifier via Supabase Scheduled Function ou pg_cron + pg_net, cadence horaire.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { stripe, assertTestMode, assertNotLive, isAuthorizedCron, serviceClient } from "../_shared/stripe.ts";

interface ReadyRow {
  mission_id: string;
  stripe_payment_intent_id: string;
  authorized_amount_cents: number;
  realized_worker_cents: number;
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

  const { data: ready, error: readyError } = await supabase.rpc("missions_ready_for_capture", {
    p_limit: 100,
  });
  if (readyError) {
    return new Response(JSON.stringify({ error: readyError.message }), { status: 500, headers });
  }

  const { data: settings } = await supabase
    .from("platform_settings")
    .select("commission_pct")
    .eq("id", true)
    .maybeSingle();
  const commissionPct = Number(settings?.commission_pct ?? 18);

  let captured = 0;
  let canceled = 0;
  let failed = 0;
  let totalCapturedCents = 0;

  for (const m of (ready ?? []) as ReadyRow[]) {
    try {
      if (m.realized_worker_cents === 0) {
        const intent = await stripe.paymentIntents.cancel(m.stripe_payment_intent_id);
        assertNotLive(intent.livemode);
        await supabase.rpc("record_mission_authorization_canceled", { p_mission_id: m.mission_id });
        canceled++;
        continue;
      }

      const commissionCents = Math.round((m.realized_worker_cents * commissionPct) / 100);
      const amountToCapture = Math.min(
        m.realized_worker_cents + commissionCents,
        m.authorized_amount_cents,
      );

      const intent = await stripe.paymentIntents.capture(m.stripe_payment_intent_id, {
        amount_to_capture: amountToCapture,
      });
      assertNotLive(intent.livemode);

      await supabase.rpc("record_mission_capture", {
        p_mission_id: m.mission_id,
        p_captured_amount_cents: amountToCapture,
      });
      captured++;
      totalCapturedCents += amountToCapture;
    } catch (err) {
      console.error("capture-missions", m.mission_id, err);
      failed++;
    }
  }

  await supabase.rpc("record_cron_execution", {
    p_job_name: "capture_missions",
    p_started_at: startedAt,
    p_checked: (ready ?? []).length,
    p_released: captured,
    p_skipped: canceled,
    p_failed: failed,
    p_total_amount_cents: totalCapturedCents,
  });

  return new Response(
    JSON.stringify({
      checked: (ready ?? []).length,
      captured,
      canceled,
      failed,
    }),
    { status: 200, headers },
  );
});
