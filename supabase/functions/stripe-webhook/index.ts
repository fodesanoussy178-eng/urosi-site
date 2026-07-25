// Edge Function `stripe-webhook` — MODE TEST.
// Point d'entrée des événements Stripe. Vérifie la signature, garantit
// l'idempotence (mark_stripe_webhook_event) puis met à jour Supabase via les
// RPC backend. Aucun corps non signé n'est traité.
//
// Déployer SANS vérification JWT :
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Secret requis : STRIPE_WEBHOOK_SECRET (whsec_…).

import {
  stripe,
  cryptoProvider,
  serviceClient,
  assertNotLive,
  webhookSecrets,
  effectiveEnv,
} from "../_shared/stripe.ts";

// Deux destinations Stripe pointent vers cette URL (« Comptes connectés » et
// « Votre compte ») : chacune a son propre secret de signature. On essaie donc
// chaque secret configuré ; l'ancien STRIPE_WEBHOOK_SECRET reste pris en compte.
const secrets = webhookSecrets();
const connectSecret = effectiveEnv.STRIPE_CONNECT_WEBHOOK_SECRET ?? "";

async function verifyAny(
  payload: string,
  signature: string,
): Promise<{ event: import("npm:stripe@17.7.0").Stripe.Event; source: "account" | "connect" } | null> {
  for (const secret of secrets) {
    try {
      const event = await stripe.webhooks.constructEventAsync(
        payload,
        signature,
        secret,
        undefined,
        cryptoProvider,
      );
      return { event, source: secret === connectSecret ? "connect" : "account" };
    } catch {
      // Essaie le secret suivant (destination différente).
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée." }), { status: 405 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature || secrets.length === 0) {
    return new Response(JSON.stringify({ error: "Signature manquante." }), { status: 400 });
  }

  const payload = await req.text();
  const verified = await verifyAny(payload, signature);
  if (!verified) {
    console.error("Signature webhook invalide (aucun secret ne correspond)");
    return new Response(JSON.stringify({ error: "Signature invalide." }), { status: 400 });
  }
  const { event, source } = verified;

  // Refuse un événement live rejoué vers l'environnement de test.
  try {
    assertNotLive(event.livemode);
  } catch (err) {
    console.error("Événement live refusé en mode test", (err as Error).message);
    return new Response(JSON.stringify({ error: "Événement live refusé." }), { status: 403 });
  }

  const supabase = serviceClient();

  // Idempotence : un event n'est traité qu'une fois.
  const { data: isNew, error: markErr } = await supabase.rpc("mark_stripe_webhook_event", {
    p_id: event.id,
    p_type: event.type,
    p_source: source,
  });
  if (markErr) {
    console.error("mark_stripe_webhook_event", markErr);
    return new Response(JSON.stringify({ error: "Erreur idempotence." }), { status: 500 });
  }
  if (!isNew) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as import("npm:stripe@17.7.0").Stripe.Account;
        const { error } = await supabase.rpc("set_worker_stripe_capabilities", {
          p_account_id: account.id,
          p_charges_enabled: account.charges_enabled,
          p_payouts_enabled: account.payouts_enabled,
        });
        if (error) throw error;
        break;
      }

      case "setup_intent.succeeded": {
        // Moyen de paiement structure enregistré (SetupIntent, aucun débit) :
        // rattaché au Customer et retenu comme moyen par défaut ici, jamais
        // à la simple création du SetupIntent côté edge function.
        const setupIntent = event.data.object as import("npm:stripe@17.7.0").Stripe.SetupIntent;
        const customerId = typeof setupIntent.customer === "string" ? setupIntent.customer : setupIntent.customer?.id;
        const paymentMethodId =
          typeof setupIntent.payment_method === "string" ? setupIntent.payment_method : setupIntent.payment_method?.id;
        if (customerId && paymentMethodId) {
          const { error } = await supabase.rpc("set_structure_default_payment_method", {
            p_stripe_customer_id: customerId,
            p_payment_method_id: paymentMethodId,
          });
          if (error) throw error;
        }
        break;
      }

      case "setup_intent.setup_failed": {
        const setupIntent = event.data.object as import("npm:stripe@17.7.0").Stripe.SetupIntent;
        const customerId = typeof setupIntent.customer === "string" ? setupIntent.customer : setupIntent.customer?.id;
        if (customerId) {
          const { error } = await supabase.rpc("notify_structure_setup_failed", {
            p_stripe_customer_id: customerId,
            p_reason: setupIntent.last_setup_error?.message ?? null,
          });
          if (error) throw error;
        }
        break;
      }

      case "transfer.created": {
        // Observabilité uniquement : le crédit travailleur est déjà enregistré
        // de façon synchrone par release-due-payments (record_stripe_mission_payment).
        // Aucune action DB nécessaire ici, mais loggé pour audit.
        const transfer = event.data.object as import("npm:stripe@17.7.0").Stripe.Transfer;
        console.log("transfer.created", transfer.id, transfer.amount, transfer.destination);
        break;
      }

      case "transfer.failed": {
        // Asynchrone : le Transfer avait réussi à la création puis a échoué
        // côté Stripe (compte fermé, devise refusée…). Jamais silencieux.
        const transfer = event.data.object as import("npm:stripe@17.7.0").Stripe.Transfer;
        const { error } = await supabase.rpc("record_transfer_failure", {
          p_transfer_id: transfer.id,
          p_reason: (transfer as unknown as { failure_message?: string }).failure_message ?? "transfer_failed",
        });
        if (error) throw error;
        break;
      }

      case "payout.paid":
      case "payout.failed":
      case "payout.canceled": {
        const payout = event.data.object as import("npm:stripe@17.7.0").Stripe.Payout;
        const status = event.type.split(".").pop()!; // paid | failed | canceled
        const { error } = await supabase.rpc("update_worker_payout_status", {
          p_stripe_payout_id: payout.id,
          p_status: status,
          p_failure_reason: payout.failure_message ?? null,
        });
        if (error) throw error;
        break;
      }

      case "identity.verification_session.verified":
      case "identity.verification_session.processing":
      case "identity.verification_session.requires_input":
      case "identity.verification_session.canceled": {
        const session = event.data.object as
          import("npm:stripe@17.7.0").Stripe.Identity.VerificationSession;
        const profileId = session.metadata?.profile_id;
        if (profileId) {
          const status = event.type.split(".").pop()!; // verified | processing | requires_input | canceled
          const { error } = await supabase.rpc("set_worker_identity_status", {
            p_profile_id: profileId,
            p_status: status,
            p_session_id: session.id,
          });
          if (error) throw error;
        }
        break;
      }

      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        // Encaissement de la structure : confirme le paiement ET l'affectation
        // du travailleur. Idempotent côté RPC (rejeu sans double traitement) et
        // côté événement (mark_stripe_webhook_event).
        const session = event.data.object as import("npm:stripe@17.7.0").Stripe.Checkout.Session;
        const applicationId = session.metadata?.application_id ?? session.client_reference_id ?? undefined;
        if (applicationId && session.payment_status === "paid") {
          const paymentIntentId =
            typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
          const { error } = await supabase.rpc("confirm_mission_checkout_payment", {
            p_application_id: applicationId,
            p_session_id: session.id,
            p_payment_intent_id: paymentIntentId,
            p_amount_total: session.amount_total ?? null,
            p_charge_id: null,
          });
          if (error) throw error;
        }
        break;
      }

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        // Paiement non terminé (abandon / expiration / échec) : ne confirme
        // rien, laisse la candidature 'pending' pour permettre une relance.
        const session = event.data.object as import("npm:stripe@17.7.0").Stripe.Checkout.Session;
        const applicationId = session.metadata?.application_id ?? session.client_reference_id ?? undefined;
        if (applicationId) {
          const { error } = await supabase.rpc("mark_mission_checkout_unpaid", {
            p_application_id: applicationId,
            p_session_id: session.id,
            p_status: event.type === "checkout.session.expired" ? "expired" : "failed",
          });
          if (error) throw error;
        }
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object as import("npm:stripe@17.7.0").Stripe.PaymentIntent;
        const applicationId = pi.metadata?.application_id;
        if (applicationId) {
          const { error } = await supabase.rpc("attach_mission_payment_intent", {
            p_application_id: applicationId,
            p_payment_intent_id: pi.id,
            p_status: "succeeded",
            p_charge_id: typeof pi.latest_charge === "string" ? pi.latest_charge : null,
          });
          if (error) throw error;
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as import("npm:stripe@17.7.0").Stripe.PaymentIntent;
        const applicationId = pi.metadata?.application_id;
        if (applicationId) {
          const { error } = await supabase.rpc("attach_mission_payment_intent", {
            p_application_id: applicationId,
            p_payment_intent_id: pi.id,
            p_status: "payment_failed",
          });
          if (error) throw error;
        }
        break;
      }

      case "charge.refunded": {
        // Remboursement (total ou partiel) du paiement de la structure.
        const charge = event.data.object as import("npm:stripe@17.7.0").Stripe.Charge;
        const { error } = await supabase.rpc("record_stripe_refund", {
          p_payment_intent_id:
            typeof charge.payment_intent === "string" ? charge.payment_intent : null,
          p_charge_id: charge.id,
          p_amount_refunded: charge.amount_refunded,
          p_fully_refunded: charge.refunded === true,
        });
        if (error) throw error;
        break;
      }

      case "charge.dispute.created": {
        // Litige/chargeback : marque paiement et candidature, notifie la structure.
        const dispute = event.data.object as import("npm:stripe@17.7.0").Stripe.Dispute;
        console.warn("Litige Stripe ouvert", dispute.id, dispute.payment_intent);
        const { error } = await supabase.rpc("record_stripe_dispute", {
          p_dispute_id: dispute.id,
          p_payment_intent_id:
            typeof dispute.payment_intent === "string" ? dispute.payment_intent : null,
          p_charge_id: typeof dispute.charge === "string" ? dispute.charge : null,
          p_amount: dispute.amount,
          p_reason: dispute.reason ?? null,
        });
        if (error) throw error;
        break;
      }

      default:
        // Événements non gérés : acquittés pour éviter les relances Stripe.
        break;
    }
  } catch (err) {
    console.error(`Traitement webhook ${event.type} échoué`, err);
    // Libère le verrou d'idempotence : le retry Stripe doit pouvoir retraiter
    // l'événement, sinon il serait acquitté comme doublon et la mise à jour perdue.
    await supabase.from("stripe_webhook_events").delete().eq("id", event.id);
    return new Response(JSON.stringify({ error: "Traitement échoué." }), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
