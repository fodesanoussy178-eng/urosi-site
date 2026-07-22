// Edge Function `stripe-connect-login` — MODE TEST.
// Renvoie un lien de connexion au tableau de bord Express du travailleur, où il
// peut consulter ses versements et **mettre à jour son IBAN** après l'onboarding.
//
// Auth : jeton utilisateur (travailleur possédant un compte connecté).

import {
  stripe,
  assertTestMode,
  denyDisallowedOrigin,
  serviceClient,
  getAuthedUser,
  jsonResponse,
  corsHeaders,
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
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.stripe_account_id) {
      return jsonResponse({ error: "Aucun compte de versement. Lance d'abord l'onboarding." }, 409, origin);
    }

    const link = await stripe.accounts.createLoginLink(profile.stripe_account_id);
    return jsonResponse({ url: link.url }, 200, origin);
  } catch (err) {
    console.error("stripe-connect-login", err);
    return jsonResponse({ error: (err as Error).message ?? "Erreur lien tableau de bord." }, 500, origin);
  }
});
