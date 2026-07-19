// Edge Function `stripe-create-payment` — MODE TEST.
// La structure provisionne une mission : crée un PaymentIntent (montant total
// = rémunération + commission) encaissé sur la plateforme, avec transfer_group
// pour le transfert J+3 au travailleur. Radar est actif par défaut ; SCA/3DS
// géré via automatic_payment_methods (obligatoire UE).
//
// Auth : jeton utilisateur (structure_admin propriétaire de la mission).
// Renvoie le client_secret pour Stripe Elements côté frontend.

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

    const body = await req.json().catch(() => ({}));
    const applicationId: string | undefined = body.application_id;
    if (!applicationId) return jsonResponse({ error: "application_id requis." }, 400, origin);

    const supabase = serviceClient();

    // Charge la candidature + mission + structure, montants calculés côté serveur.
    const { data: app, error: appErr } = await supabase
      .from("applications")
      .select(
        "id, status, worker_id, stripe_payment_intent_id, " +
          "missions!inner(id, title, worker_rate_cents, is_solidaire, " +
          "structures!inner(id, owner_id, name, stripe_customer_id))",
      )
      .eq("id", applicationId)
      .maybeSingle();
    if (appErr) throw appErr;
    if (!app) return jsonResponse({ error: "Candidature introuvable." }, 404, origin);

    interface AppRow {
      id: string;
      status: string;
      worker_id: string;
      stripe_payment_intent_id: string | null;
      missions: {
        id: string;
        title: string;
        worker_rate_cents: number;
        is_solidaire: boolean;
        structures: {
          id: string;
          owner_id: string;
          name: string;
          stripe_customer_id: string | null;
        };
      };
    }

    const row = app as unknown as AppRow;
    const mission = row.missions;
    const structure = mission.structures;

    if (structure.owner_id !== user.id) {
      return jsonResponse({ error: "Non autorisé pour cette mission." }, 403, origin);
    }
    if (mission.is_solidaire || mission.worker_rate_cents <= 0) {
      return jsonResponse({ error: "Mission solidaire : aucun paiement." }, 400, origin);
    }
    if (row.stripe_payment_intent_id) {
      // Idempotence simple : réutilise le PaymentIntent existant.
      const existing = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id);
      if (existing.status !== "canceled") {
        return jsonResponse(
          { client_secret: existing.client_secret, amount: existing.amount, reused: true },
          200,
          origin,
        );
      }
    }

    const { data: settings } = await supabase
      .from("platform_settings")
      .select("commission_pct")
      .eq("id", true)
      .maybeSingle();
    const pct = Number(settings?.commission_pct ?? 15);
    const brut = mission.worker_rate_cents as number;
    const commission = Math.round((brut * pct) / 100);
    const total = brut + commission;

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

    const intent = await stripe.paymentIntents.create(
      {
        amount: total,
        currency: "eur",
        customer: customerId,
        automatic_payment_methods: { enabled: true },
        transfer_group: `mission_${row.id}`,
        metadata: {
          application_id: row.id,
          mission_id: mission.id,
          structure_id: structure.id,
          worker_id: row.worker_id,
          worker_amount_cents: String(brut),
          commission_cents: String(commission),
        },
      },
      { idempotencyKey: `pi_mission_${row.id}` },
    );

    await supabase.rpc("attach_mission_payment_intent", {
      p_application_id: row.id,
      p_payment_intent_id: intent.id,
      p_status: intent.status,
    });

    return jsonResponse(
      { client_secret: intent.client_secret, amount: total, commission_cents: commission },
      200,
      origin,
    );
  } catch (err) {
    console.error("stripe-create-payment", err);
    return jsonResponse({ error: (err as Error).message ?? "Erreur paiement." }, 500, origin);
  }
});
