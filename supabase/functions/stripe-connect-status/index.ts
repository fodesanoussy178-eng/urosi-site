// Edge Function `stripe-connect-status` — MODE TEST.
// Rafraîchit et renvoie l'état du compte connecté du travailleur appelant
// (charges_enabled / payouts_enabled / details_submitted). Utile au retour de
// l'onboarding ; les mises à jour temps réel passent par le webhook account.updated.

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
      .select("stripe_account_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.stripe_account_id) {
      return jsonResponse({ onboarded: false, charges_enabled: false, payouts_enabled: false }, 200, origin);
    }

    const account = await stripe.accounts.retrieve(profile.stripe_account_id);
    await supabase.rpc("set_worker_stripe_capabilities", {
      p_account_id: account.id,
      p_charges_enabled: account.charges_enabled,
      p_payouts_enabled: account.payouts_enabled,
    });

    return jsonResponse(
      {
        onboarded: account.details_submitted,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
      },
      200,
      origin,
    );
  } catch (err) {
    console.error("stripe-connect-status", err);
    return jsonResponse({ error: (err as Error).message ?? "Erreur statut." }, 500, origin);
  }
});
