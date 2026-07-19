// Edge Function `stripe-identity-start` — MODE TEST.
// Démarre une VerificationSession Stripe Identity (document + selfie) pour le
// travailleur appelant et enregistre le statut `pending`. Le résultat final
// arrive via le webhook identity.verification_session.* et alimente le KYC.
//
// Auth : jeton utilisateur (travailleur). Renvoie le client_secret pour le
// modal Stripe.js Identity.

import {
  stripe,
  assertStripeConfigured,
  serviceClient,
  getAuthedUser,
  jsonResponse,
  corsHeaders,
} from "../_shared/stripe.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Méthode non autorisée." }, 405, origin);

  try {
    assertStripeConfigured();

    const user = await getAuthedUser(req);
    if (!user) return jsonResponse({ error: "Connexion requise." }, 401, origin);

    const supabase = serviceClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, stripe_identity_status")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "worker") {
      return jsonResponse({ error: "Vérification réservée aux travailleurs." }, 403, origin);
    }
    if (profile?.stripe_identity_status === "verified") {
      return jsonResponse({ status: "verified", already: true }, 200, origin);
    }

    const session = await stripe.identity.verificationSessions.create(
      {
        type: "document",
        metadata: { profile_id: user.id },
        options: { document: { require_matching_selfie: true } },
      },
      { idempotencyKey: `identity_${user.id}` },
    );

    await supabase.rpc("set_worker_identity_status", {
      p_profile_id: user.id,
      p_status: "pending",
      p_session_id: session.id,
    });

    return jsonResponse({ client_secret: session.client_secret, status: "pending" }, 200, origin);
  } catch (err) {
    console.error("stripe-identity-start", err);
    return jsonResponse({ error: (err as Error).message ?? "Erreur vérification." }, 500, origin);
  }
});
