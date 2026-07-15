// Edge Function `psp` — abstraction neutre du futur service de paiement.
//
// MVP : les mouvements (provisionnement / retrait) sont simules et enregistres
// dans le wallet interne via les RPC deposit_wallet / withdraw_wallet.
// Une integration externe future devra implementer PaymentProvider et ne
// confirmer un mouvement qu'apres retour verifie de son API ou webhook.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

interface PspRequest {
  action: "deposit" | "withdraw";
  amount_cents: number;
  label?: string;
}

interface PaymentResult {
  ok: boolean;
  reference: string;
  status: 'simulated' | 'pending' | 'confirmed' | 'failed';
}

interface PaymentProvider {
  createPayment(action: PspRequest['action'], amountCents: number): Promise<PaymentResult>;
  getPaymentStatus(reference: string): Promise<PaymentResult>;
  refundPayment(reference: string): Promise<PaymentResult>;
  createUserWallet(userId: string): Promise<{ reference: string }>;
}

class InternalSimulatedPaymentProvider implements PaymentProvider {
  async createPayment(action: PspRequest['action'], amountCents: number): Promise<PaymentResult> {
    return { ok: amountCents > 0, reference: `internal_${action}_${crypto.randomUUID()}`, status: 'simulated' };
  }

  async getPaymentStatus(reference: string): Promise<PaymentResult> {
    return { ok: true, reference, status: 'simulated' };
  }

  async refundPayment(reference: string): Promise<PaymentResult> {
    return { ok: true, reference, status: 'simulated' };
  }

  async createUserWallet(userId: string): Promise<{ reference: string }> {
    return { reference: `internal_wallet_${userId}` };
  }
}

const paymentProvider: PaymentProvider = new InternalSimulatedPaymentProvider();

Deno.serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  const headers = { ...cors, "Content-Type": "application/json" };

  try {
    const body = (await req.json()) as PspRequest;
    if (!body || !["deposit", "withdraw"].includes(body.action) || !Number.isInteger(body.amount_cents)) {
      return new Response(JSON.stringify({ error: "Requête invalide." }), { status: 400, headers });
    }

    // Client au nom de l'utilisateur : la RLS et les contrôles des RPC s'appliquent.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    const provider = await paymentProvider.createPayment(body.action, body.amount_cents);
    if (!provider.ok) {
      return new Response(JSON.stringify({ error: "Le traitement interne a refusé l'opération." }), {
        status: 402,
        headers,
      });
    }

    const { data, error } = body.action === "deposit"
      ? await supabase.rpc("deposit_wallet", {
        p_amount_cents: body.amount_cents,
        p_label: body.label ?? `Provisionnement (${provider.reference})`,
      })
      : await supabase.rpc("withdraw_wallet", { p_amount_cents: body.amount_cents });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400, headers });
    }

    return new Response(
      JSON.stringify({ balance_cents: data, provider_reference: provider.reference, provider_status: provider.status }),
      { headers },
    );
  } catch {
    return new Response(JSON.stringify({ error: "Erreur interne." }), { status: 500, headers });
  }
});
