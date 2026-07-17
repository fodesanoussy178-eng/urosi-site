// Edge Function `release-due-payments` — libération J+3 des missions.
//
// Audit 2026-07-16 (H2) : sélectionne les candidatures `payment_pending`
// dont `payment_ready_at` est échu et appelle la RPC backend
// `release_payment_ready_mission` (réservée au service_role) pour chacune.
//
// ⚠️ NE PAS PLANIFIER TANT QUE LE PSP N'EST PAS ACTIF.
// Hors staging, `private.guard_simulated_payment` bloque tout paiement
// `provider='internal'` : chaque libération échouerait volontairement.
// Au go-live PSP, planifier cette fonction (Supabase Scheduled Function ou
// pg_cron + pg_net) avec l'en-tête Authorization service_role.
//
// Aucun accès public : l'appelant doit présenter la clé service_role.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json" };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée." }), {
      status: 405,
      headers,
    });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!serviceRoleKey || provided !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Accès réservé au backend UROSI." }), {
      status: 401,
      headers,
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    serviceRoleKey,
    { auth: { persistSession: false } },
  );

  const { data: due, error: selectError } = await supabase
    .from("applications")
    .select("id")
    .eq("status", "payment_pending")
    .lte("payment_ready_at", new Date().toISOString())
    .limit(100);

  if (selectError) {
    return new Response(JSON.stringify({ error: selectError.message }), {
      status: 500,
      headers,
    });
  }

  const released: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const app of due ?? []) {
    const { error } = await supabase.rpc("release_payment_ready_mission", {
      p_application_id: app.id,
    });
    if (error) {
      // Attendu hors staging tant que le PSP n'est pas branché
      // (guard_simulated_payment) : on journalise sans interrompre le lot.
      failed.push({ id: app.id, error: error.message });
    } else {
      released.push(app.id);
    }
  }

  return new Response(
    JSON.stringify({ checked: (due ?? []).length, released, failed }),
    { status: 200, headers },
  );
});
