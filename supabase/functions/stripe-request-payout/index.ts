// Edge Function `stripe-request-payout` — MODE TEST.
// Le travailleur demande le virement de son solde Stripe disponible vers son
// compte bancaire. Les comptes connectés Express sont configurés en
// versements MANUELS (settings.payouts.schedule.interval = 'manual', posé à
// l'onboarding par stripe-connect-onboard) : Stripe ne reverse jamais seul
// le solde, ce bouton est l'unique déclencheur.
//
// Auth : jeton utilisateur (travailleur possédant un compte connecté avec
// les versements activés). Écriture via RPC record_worker_payout_request,
// réservée au backend (appelée ici en service_role, jamais avec le jeton
// de l'appelant).

import {
  stripe,
  assertTestMode,
  assertNotLive,
  denyDisallowedOrigin,
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
  const deny = denyDisallowedOrigin(origin);
  if (deny) return deny;

  try {
    assertTestMode();

    const user = await getAuthedUser(req);
    if (!user) return jsonResponse({ error: "Connexion requise." }, 401, origin);

    const supabase = serviceClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_payouts_enabled")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.stripe_account_id) {
      return jsonResponse({ error: "Aucun compte de versement. Lance d'abord l'onboarding." }, 409, origin);
    }
    if (!profile.stripe_payouts_enabled) {
      return jsonResponse(
        { error: "Les versements ne sont pas encore activés sur ton compte Stripe." },
        409,
        origin,
      );
    }

    const balance = await stripe.balance.retrieve({ stripeAccount: profile.stripe_account_id });
    const availableCents = sumEur(balance.available);
    if (availableCents <= 0) {
      return jsonResponse({ error: "Aucun solde disponible à verser pour le moment." }, 409, origin);
    }

    const payout = await stripe.payouts.create(
      { amount: availableCents, currency: "eur" },
      {
        stripeAccount: profile.stripe_account_id,
        idempotencyKey: `payout_${user.id}_${availableCents}`,
      },
    );
    assertNotLive(payout.livemode);

    const { error: rpcErr } = await supabase.rpc("record_worker_payout_request", {
      p_worker_id: user.id,
      p_stripe_account_id: profile.stripe_account_id,
      p_stripe_payout_id: payout.id,
      p_amount_cents: availableCents,
    });
    if (rpcErr) throw rpcErr;

    return jsonResponse(
      { payout_id: payout.id, amount_cents: availableCents, status: payout.status },
      200,
      origin,
    );
  } catch (err) {
    console.error("stripe-request-payout", err);
    return jsonResponse({ error: (err as Error).message ?? "Erreur lors de la demande de virement." }, 500, origin);
  }
});
