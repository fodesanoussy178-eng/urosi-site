// Edge Function `stripe-refund-mission` — MODE TEST.
// Rembourse l'encaissement Stripe d'une mission confirmée quand la structure
// l'annule définitivement. Crée un Stripe Refund sur le PaymentIntent de la
// mission ; c'est ensuite le webhook `charge.refunded` (→ record_stripe_refund)
// qui synchronise Supabase : candidature remboursée, Wallet ramené à l'état
// réel, notifications. Cette fonction ne fait qu'initier le remboursement.
//
// Auth : jeton utilisateur (structure_admin propriétaire de la mission).
// Idempotent : un idempotencyKey par candidature évite tout double
// remboursement ; un PaymentIntent déjà remboursé est traité comme un succès.

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

interface AppRow {
  id: string;
  stripe_payment_intent_id: string | null;
  stripe_payment_status: string | null;
  missions: {
    id: string;
    is_solidaire: boolean;
    structures: { id: string; owner_id: string };
  };
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

    const body = await req.json().catch(() => ({}));
    const applicationId: string | undefined = body.application_id;
    if (!applicationId) return jsonResponse({ error: "application_id requis." }, 400, origin);

    const supabase = serviceClient();
    const { data: app, error: appErr } = await supabase
      .from("applications")
      .select(
        "id, stripe_payment_intent_id, stripe_payment_status, " +
          "missions!inner(id, is_solidaire, structures!inner(id, owner_id))",
      )
      .eq("id", applicationId)
      .maybeSingle();
    if (appErr) throw appErr;
    if (!app) return jsonResponse({ error: "Candidature introuvable." }, 404, origin);

    const row = app as unknown as AppRow;
    if (row.missions.structures.owner_id !== user.id) {
      return jsonResponse({ error: "Non autorisé pour cette mission." }, 403, origin);
    }
    if (!row.stripe_payment_intent_id || row.stripe_payment_status !== "paid") {
      // Rien à rembourser : mission non payée (ou déjà remboursée). Succès neutre
      // pour que l'annulation puisse se poursuivre sans erreur côté client.
      return jsonResponse({ refunded: false, reason: "not_paid" }, 200, origin);
    }

    try {
      const refund = await stripe.refunds.create(
        { payment_intent: row.stripe_payment_intent_id },
        { idempotencyKey: `refund_mission_${row.id}` },
      );
      assertNotLive(refund.livemode);
      return jsonResponse({ refunded: true, refund_id: refund.id, status: refund.status }, 200, origin);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "charge_already_refunded") {
        return jsonResponse({ refunded: true, already: true }, 200, origin);
      }
      throw err;
    }
  } catch (err) {
    console.error("stripe-refund-mission", err);
    return jsonResponse({ error: (err as Error).message ?? "Remboursement impossible." }, 500, origin);
  }
});
