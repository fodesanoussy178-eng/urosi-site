// Edge Function `stripe-connect-onboard` — MODE TEST.
// Crée (ou réutilise) le compte connecté Express du travailleur appelant et
// renvoie une Account Link Stripe pour l'onboarding hébergé.
//
// Auth : jeton utilisateur (travailleur). Écriture via RPC set_worker_stripe_account.

import {
  stripe,
  assertTestMode,
  assertNotLive,
  denyDisallowedOrigin,
  serviceClient,
  getAuthedUser,
  jsonResponse,
  corsHeaders,
  appUrl,
} from "../_shared/stripe.ts";

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
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, role, stripe_account_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileErr) throw profileErr;
    if (!profile) return jsonResponse({ error: "Profil introuvable." }, 404, origin);
    if (profile.role !== "worker") {
      return jsonResponse({ error: "Seuls les travailleurs ont un compte de versement." }, 403, origin);
    }

    let accountId: string | null = profile.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "FR",
        email: user.email ?? undefined,
        business_type: "individual",
        default_currency: "eur",
        capabilities: { transfers: { requested: true } },
        // Versements automatiques : Stripe reverse le solde vers l'IBAN du
        // travailleur chaque jour, sans action manuelle.
        settings: { payouts: { schedule: { interval: "daily" } } },
        metadata: { profile_id: user.id },
      });
      assertNotLive(account.livemode);
      accountId = account.id;
      const { error: rpcErr } = await supabase.rpc("set_worker_stripe_account", {
        p_profile_id: user.id,
        p_account_id: accountId,
      });
      if (rpcErr) throw rpcErr;
    }

    const body = await req.json().catch(() => ({}));
    const base = appUrl();
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: body.refresh_url ?? `${base}/app?stripe=refresh`,
      return_url: body.return_url ?? `${base}/app?stripe=return`,
      type: "account_onboarding",
      // Collecte immédiate de toutes les infos requises, IBAN inclus (et pas
      // seulement le strict minimum différé).
      collection_options: { fields: "eventually_due" },
    });

    return jsonResponse({ url: link.url, account_id: accountId }, 200, origin);
  } catch (err) {
    console.error("stripe-connect-onboard", err);
    return jsonResponse({ error: (err as Error).message ?? "Erreur onboarding." }, 500, origin);
  }
});
