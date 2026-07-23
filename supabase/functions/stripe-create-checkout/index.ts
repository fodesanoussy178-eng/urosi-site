// Edge Function `stripe-create-checkout` — MODE TEST.
// La structure paie ET confirme une mission : crée une Stripe Checkout Session
// (mode payment) dont le montant est calculé UNIQUEMENT côté serveur à partir
// des données fiables de la mission (rémunération travailleur + commission
// UROSI). Aucun montant fourni par le frontend n'est accepté.
//
// La candidature reste 'pending' : seule la confirmation du paiement par le
// webhook (checkout.session.completed) la fait passer à 'accepted'. Cette
// fonction ne fait que provisionner la session et renvoyer son URL hébergée.
//
// Auth : jeton utilisateur (structure_admin propriétaire de la mission).

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
  effectiveEnv,
} from "../_shared/stripe.ts";

interface AppRow {
  id: string;
  status: string;
  worker_id: string;
  stripe_payment_status: string | null;
  stripe_checkout_session_id: string | null;
  missions: {
    id: string;
    title: string;
    worker_rate_cents: number;
    is_solidaire: boolean;
    scheduled_date: string | null;
    structures: {
      id: string;
      owner_id: string;
      name: string;
      stripe_customer_id: string | null;
    };
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
        "id, status, worker_id, stripe_payment_status, stripe_checkout_session_id, " +
          "missions!inner(id, title, worker_rate_cents, is_solidaire, scheduled_date, " +
          "structures!inner(id, owner_id, name, stripe_customer_id))",
      )
      .eq("id", applicationId)
      .maybeSingle();
    if (appErr) throw appErr;
    if (!app) return jsonResponse({ error: "Candidature introuvable." }, 404, origin);

    const row = app as unknown as AppRow;
    const mission = row.missions;
    const structure = mission.structures;

    if (structure.owner_id !== user.id) {
      return jsonResponse({ error: "Non autorisé pour cette mission." }, 403, origin);
    }
    if (mission.is_solidaire || mission.worker_rate_cents <= 0) {
      return jsonResponse({ error: "Mission solidaire : aucun paiement requis." }, 400, origin);
    }
    if (row.stripe_payment_status === "paid" || row.status !== "pending") {
      return jsonResponse({ error: "Cette candidature est déjà confirmée." }, 409, origin);
    }

    // Montant calculé côté serveur — jamais lu depuis la requête.
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("commission_pct")
      .eq("id", true)
      .maybeSingle();
    const pct = Number(settings?.commission_pct ?? 18);
    const workerCents = mission.worker_rate_cents;
    const commissionCents = Math.round((workerCents * pct) / 100);
    const totalCents = workerCents + commissionCents;

    // Réutilise une session encore ouverte (évite un double encaissement si la
    // structure reclique) ; une session expirée/complétée → nouvelle session.
    if (row.stripe_checkout_session_id) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id);
        assertNotLive(existing.livemode);
        if (existing.status === "open" && existing.url) {
          return jsonResponse({ url: existing.url, reused: true }, 200, origin);
        }
      } catch (err) {
        if ((err as { code?: string }).code !== "resource_missing") throw err;
      }
    }

    // Customer de la structure (créé une fois, réutilisé ensuite).
    let customerId: string | null = structure.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: structure.name,
        email: user.email ?? undefined,
        metadata: { structure_id: structure.id, owner_id: user.id },
      });
      customerId = customer.id;
      await supabase.rpc("set_structure_stripe_customer", {
        p_structure_id: structure.id,
        p_customer_id: customerId,
      });
    }

    const base = appUrl();
    const testMode = (effectiveEnv.STRIPE_TEST_MODE ?? "true") !== "false";
    const metadata = {
      application_id: row.id,
      mission_id: mission.id,
      structure_id: structure.id,
      worker_id: row.worker_id,
      worker_amount_cents: String(workerCents),
      commission_cents: String(commissionCents),
      environment: testMode ? "test" : "live",
    };

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer: customerId,
        client_reference_id: row.id,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: totalCents,
              product_data: {
                name: `Mission « ${mission.title} »`,
                description:
                  `Rémunération travailleur ${(workerCents / 100).toFixed(2)} € + ` +
                  `commission UROSI ${(commissionCents / 100).toFixed(2)} €`,
              },
            },
          },
        ],
        payment_intent_data: {
          transfer_group: `mission_${row.id}`,
          metadata,
        },
        metadata,
        success_url: `${base}/paiement/succes?session_id={CHECKOUT_SESSION_ID}&application_id=${row.id}`,
        cancel_url: `${base}/paiement/annule?application_id=${row.id}`,
      },
      { idempotencyKey: `checkout_mission_${row.id}_${workerCents}_${commissionCents}` },
    );
    assertNotLive(session.livemode);

    await supabase.rpc("attach_mission_checkout_session", {
      p_application_id: row.id,
      p_session_id: session.id,
    });

    return jsonResponse(
      { url: session.url, session_id: session.id, amount: totalCents, commission_cents: commissionCents },
      200,
      origin,
    );
  } catch (err) {
    console.error("stripe-create-checkout", err);
    return jsonResponse({ error: (err as Error).message ?? "Erreur paiement." }, 500, origin);
  }
});
