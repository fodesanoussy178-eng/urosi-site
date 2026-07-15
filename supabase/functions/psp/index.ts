// Edge Function `psp` — point d'entrée réservé au futur prestataire de paiement.
// Aucun mouvement simulé ne doit modifier un wallet réel.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  const headers = { ...cors, "Content-Type": "application/json" };

  return new Response(
    JSON.stringify({ error: "Paiements externes non activés. Aucun mouvement n'a été créé." }),
    { status: 503, headers },
  );
});
