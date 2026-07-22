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
} from "../_shared/stripe.ts";

// Deux destinations Stripe pointent vers cette URL (« Comptes connectés » et
// « Votre compte ») : chacune a son propre secret de signature. On essaie donc
// chaque secret configuré ; l'ancien STRIPE_WEBHOOK_SECRET reste pris en compte.
const secrets = webhookSecrets(Deno.env.toObject());

async function verifyAny(
  payload: string,
  signature: string,
): Promise<import("npm:stripe@17.7.0").Stripe.Event | null> {
  for (const secret of secrets) {
    try {
      return await stripe.webhooks.constructEventAsync(
        payload,
        signature,
        secret,
        undefined,
        cryptoProvider,
      );
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
  const event = await verifyAny(payload, signature);
  if (!event) {
    console.error("Signature webhook invalide (aucun secret ne correspond)");
    return new Response(JSON.stringify({ error: "Signature invalide." }), { status: 400 });
  }

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
        await supabase.rpc("set_worker_stripe_capabilities", {
          p_account_id: account.id,
          p_charges_enabled: account.charges_enabled,
          p_payouts_enabled: account.payouts_enabled,
        });
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
          await supabase.rpc("set_worker_identity_status", {
            p_profile_id: profileId,
            p_status: status,
            p_session_id: session.id,
          });
        }
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object as import("npm:stripe@17.7.0").Stripe.PaymentIntent;
        const applicationId = pi.metadata?.application_id;
        if (applicationId) {
          await supabase.rpc("attach_mission_payment_intent", {
            p_application_id: applicationId,
            p_payment_intent_id: pi.id,
            p_status: "succeeded",
            p_charge_id: typeof pi.latest_charge === "string" ? pi.latest_charge : null,
          });
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as import("npm:stripe@17.7.0").Stripe.PaymentIntent;
        const applicationId = pi.metadata?.application_id;
        if (applicationId) {
          await supabase.rpc("attach_mission_payment_intent", {
            p_application_id: applicationId,
            p_payment_intent_id: pi.id,
            p_status: "payment_failed",
          });
        }
        break;
      }

      case "charge.dispute.created": {
        // Litige/chargeback : à traiter côté opérations (Radar / support).
        const dispute = event.data.object as import("npm:stripe@17.7.0").Stripe.Dispute;
        console.warn("Litige Stripe ouvert", dispute.id, dispute.payment_intent);
        break;
      }

      default:
        // Événements non gérés : acquittés pour éviter les relances Stripe.
        break;
    }
  } catch (err) {
    console.error(`Traitement webhook ${event.type} échoué`, err);
    return new Response(JSON.stringify({ error: "Traitement échoué." }), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
