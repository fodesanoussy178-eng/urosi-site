// Edge Function `process-spot-offers` — expiration des offres de place.
//
// Fait respecter la fenêtre de confirmation de 2 minutes de la liste
// d'attente (migration 20260716140000) : expire les offres non confirmées
// et fait avancer la file via la RPC `expire_overdue_spot_offers`
// (réservée au service_role). Jamais de pg_sleep : c'est cette tâche
// planifiée (cadence recommandée : 1 minute) qui fait le travail.
//
// Planification : Dashboard Supabase → Edge Functions → Schedules,
// avec l'en-tête Authorization service_role. Contrairement à
// release-due-payments, cette fonction est indépendante du PSP et peut
// être planifiée dès maintenant.

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

  const { data, error } = await supabase.rpc("expire_overdue_spot_offers");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers,
    });
  }

  return new Response(JSON.stringify({ expired_offers: data ?? 0 }), {
    status: 200,
    headers,
  });
});
