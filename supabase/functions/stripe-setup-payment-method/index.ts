// Edge Function `stripe-setup-payment-method` — MODE TEST.
// Enregistre le moyen de paiement d'une structure (carte, Apple Pay, Google
// Pay) via un SetupIntent (usage: off_session) — AUCUN débit. Appelée UNE
// SEULE FOIS, au moment de la première publication d'une mission rémunérée
// (jamais à l'inscription, jamais pour une structure qui ne publie que du
// solidaire — ce garde-fou est côté frontend, cette fonction ne fait que ce
// qu'on lui demande).
//
// Le payment_method confirmé est rattaché au Customer et retenu comme moyen
// par défaut via le webhook setup_intent.succeeded (set_structure_default_
// payment_method), jamais ici : la confirmation réelle vient de Stripe, pas
// de la simple création du SetupIntent.
//
// Auth : jeton utilisateur (structure_admin propriétaire de la structure).

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

    const body = await req.json().catch(() => ({}));
    const structureId: string | undefined = body.structure_id;
    const requestId: string = typeof body.request_id === "string" && body.request_id ? body.request_id : crypto.randomUUID();

    const supabase = serviceClient();
    const query = supabase
      .from("structures")
      .select("id, owner_id, name, stripe_customer_id")
      .eq("owner_id", user.id);
    const { data: structure, error: structureErr } = structureId
      ? await query.eq("id", structureId).maybeSingle()
      : await query.limit(1).maybeSingle();
    if (structureErr) throw structureErr;
    if (!structure) return jsonResponse({ error: "Structure introuvable." }, 404, origin);

    // Customer Stripe de la structure (créé une fois, réutilisé ensuite —
    // même logique que stripe-create-checkout).
    let customerId: string | null = structure.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: structure.name,
        email: user.email ?? undefined,
        metadata: { structure_id: structure.id, owner_id: user.id },
      });
      assertNotLive(customer.livemode);
      customerId = customer.id;
      const { error: rpcErr } = await supabase.rpc("set_structure_stripe_customer", {
        p_structure_id: structure.id,
        p_customer_id: customerId,
      });
      if (rpcErr) throw rpcErr;
    }

    // automatic_payment_methods laisse Stripe proposer carte + Apple Pay +
    // Google Pay dans le Payment Element côté client (Apple Pay nécessite en
    // plus que le domaine soit enregistré dans le Dashboard Stripe — étape
    // opérationnelle, pas du code).
    const setupIntent = await stripe.setupIntents.create(
      {
        customer: customerId,
        usage: "off_session",
        automatic_payment_methods: { enabled: true },
        metadata: { structure_id: structure.id, owner_id: user.id },
      },
      { idempotencyKey: `setup_${structure.id}_${requestId}` },
    );
    assertNotLive(setupIntent.livemode);

    return jsonResponse(
      { client_secret: setupIntent.client_secret, customer_id: customerId },
      200,
      origin,
    );
  } catch (err) {
    console.error("stripe-setup-payment-method", err);
    return jsonResponse({ error: (err as Error).message ?? "Erreur d'enregistrement du moyen de paiement." }, 500, origin);
  }
});
