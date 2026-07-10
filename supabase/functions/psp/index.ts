// Edge Function `psp` — abstraction du prestataire de paiement (PSP).
//
// MVP : les mouvements (provisionnement / retrait) sont simules et enregistres
// dans le wallet interne via les RPC deposit_wallet / withdraw_wallet.
// Pour brancher Lemonway ou Stripe :
//  1. Ajouter les secrets (LEMONWAY_API_KEY / STRIPE_SECRET_KEY) au projet.
//  2. Remplacer `simulateProvider` par l'appel reel (money-in / payout).
//  3. Ne crediter le wallet interne qu'apres confirmation du PSP (webhook).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

interface PspRequest {
  action: "deposit" | "withdraw";
  amount_cents: number;
  label?: string;
}

async function simulateProvider(action: string, amountCents: number): Promise<{ ok: boolean; reference: string }> {
  // Ici viendra l'appel Lemonway (P2P / MoneyIn) ou Stripe (PaymentIntent / Payout).
  return { ok: amountCents > 0, reference: `sim_${action}_${crypto.randomUUID()}` };
}

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

    const provider = await simulateProvider(body.action, body.amount_cents);
    if (!provider.ok) {
      return new Response(JSON.stringify({ error: "Le prestataire de paiement a refusé l'opération." }), {
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
      JSON.stringify({ balance_cents: data, provider_reference: provider.reference }),
      { headers },
    );
  } catch {
    return new Response(JSON.stringify({ error: "Erreur interne." }), { status: 500, headers });
  }
});
