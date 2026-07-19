// Edge Function `stripe-connect-balance` — MODE TEST.
// Renvoie le solde Stripe du travailleur appelant (disponible + en attente),
// destiné à remplacer l'affichage de l'ancien wallet interne simulé : avec
// Connect, l'argent réel vit dans le compte Stripe du travailleur.

import {
  stripe,
  assertStripeConfigured,
  serviceClient,
  getAuthedUser,
  jsonResponse,
  corsHeaders,
} from "../_shared/stripe.ts";

function sumEur(entries: Array<{ amount: number; currency: string }>): number {
  return entries
    .filter((e) => e.currency === "eur")
    .reduce((total, e) => total + e.amount, 0);
}

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
      .select("stripe_account_id, stripe_payouts_enabled")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.stripe_account_id) {
      return jsonResponse({ available_cents: 0, pending_cents: 0, onboarded: false }, 200, origin);
    }

    const balance = await stripe.balance.retrieve({ stripeAccount: profile.stripe_account_id });
    return jsonResponse(
      {
        onboarded: true,
        payouts_enabled: profile.stripe_payouts_enabled,
        available_cents: sumEur(balance.available),
        pending_cents: sumEur(balance.pending),
      },
      200,
      origin,
    );
  } catch (err) {
    console.error("stripe-connect-balance", err);
    return jsonResponse({ error: (err as Error).message ?? "Erreur solde." }, 500, origin);
  }
});
