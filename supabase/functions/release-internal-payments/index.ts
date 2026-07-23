// Edge Function `release-internal-payments` — libère à J+3, sans intervention
// du travailleur, les paiements internes (wallet simulé, hors Stripe) dont
// l'échéance est atteinte.
//
// Le mouvement 'pending' est créé IMMÉDIATEMENT à la confirmation de fin de
// mission (trigger applications_pending_wallet_earning). Cette fonction ne
// fait que déclencher, pour chaque candidature `payment_pending` échue,
// release_payment_ready_mission (candidature -> 'completed'), dont le
// trigger applications_pay_on_completion appelle process_mission_payment :
// celui-ci PROMEUT le mouvement 'pending' existant en 'available' (au lieu
// d'en créer un nouveau), incrémentant alors le solde disponible du
// travailleur via le trigger wallet_apply_transaction déjà en place.
//
// Accès réservé au backend : l'appelant présente la clé service_role.
// Planifier via Supabase Scheduled Function ou pg_cron + pg_net (même
// mécanisme prévu — non encore câblé côté infra — que release-due-payments
// pour les paiements Stripe).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json" };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée." }), { status: 405, headers });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!serviceRoleKey || provided !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Accès réservé au backend UROSI." }), { status: 401, headers });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: due, error: selectError } = await supabase
    .from("applications")
    .select("id")
    .eq("status", "payment_pending")
    .lte("payment_ready_at", new Date().toISOString())
    .limit(200);

  if (selectError) {
    return new Response(JSON.stringify({ error: selectError.message }), { status: 500, headers });
  }

  const released: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const a of due ?? []) {
    try {
      const { error } = await supabase.rpc("release_payment_ready_mission", { p_application_id: a.id });
      if (error) throw error;
      released.push(a.id);
    } catch (err) {
      // Une mission bloquée (signalement ouvert, annulée…) ne doit pas
      // interrompre le traitement des autres candidatures échues.
      skipped.push({ id: a.id, reason: (err as Error).message });
    }
  }

  return new Response(
    JSON.stringify({ checked: (due ?? []).length, released, skipped }),
    { status: 200, headers },
  );
});
