// Utilitaires partagés des Edge Functions Stripe (Deno) — MODE TEST.
//
// Secrets attendus (jamais commités ; `supabase secrets set …`) :
//   STRIPE_SECRET_KEY        clé secrète Stripe (sk_test_… en mode test)
//   STRIPE_WEBHOOK_SECRET    secret de signature du endpoint webhook (whsec_…)
//   SUPABASE_URL             injecté par la plateforme
//   SUPABASE_SERVICE_ROLE_KEY  injecté par la plateforme
//   APP_URL                  base des redirections onboarding (def. https://app.urosi.fr)

import Stripe from "npm:stripe@17.7.0";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export { Stripe };

const secretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

// Client Stripe compatible Deno (fetch + WebCrypto pour la vérification async).
export const stripe = new Stripe(secretKey, {
  apiVersion: "2025-06-30.basil",
  httpClient: Stripe.createFetchHttpClient(),
});

export const cryptoProvider = Stripe.createSubtleCryptoProvider();

export function assertStripeConfigured(): void {
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY absent : configurez les secrets Supabase.");
  }
}

// CORS : origines autorisées uniquement (audit L3 sur l'ancienne fonction psp).
const ALLOWED_ORIGINS = new Set([
  "https://urosi.fr",
  "https://www.urosi.fr",
  "https://app.urosi.fr",
  "http://localhost:5173",
  "http://localhost:4173",
]);

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://app.urosi.fr";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// Client service_role : bypass RLS, appelle les RPC réservées au backend.
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
}

// Identifie l'utilisateur appelant à partir de son jeton (fonctions initiées
// par un utilisateur : onboarding, paiement, Identity).
export async function getAuthedUser(
  req: Request,
): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

export function appUrl(): string {
  return Deno.env.get("APP_URL") ?? "https://app.urosi.fr";
}
