// Utilitaires partagés des Edge Functions Stripe (Deno) — MODE TEST.
//
// Secrets attendus (jamais commités ; `supabase secrets set …`) :
//   STRIPE_SECRET_KEY               clé secrète Stripe (sk_test_… en mode test)
//   STRIPE_TEST_MODE                'true' (défaut) tant que la phase live n'est pas ouverte
//   STRIPE_CONNECT_WEBHOOK_SECRET   signature du endpoint « Comptes connectés »
//   STRIPE_ACCOUNT_WEBHOOK_SECRET   signature du endpoint « Votre compte »
//   STRIPE_CRON_SECRET              secret du déclenchement release-due-payments
//   APP_URL                         base des redirections onboarding
//   STRIPE_PREVIEW_ORIGIN           origine(s) Vercel Preview autorisées (CSV)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY : injectés.
//
// Config de secours : si STRIPE_SECRET_KEY d'environnement est absente ou
// invalide en mode test, la config Stripe est rechargée depuis
// private.stripe_config (RPC get_stripe_config, service_role uniquement).
// Ce filet évite qu'un secret mal collé laisse l'environnement inutilisable ;
// les valeurs d'environnement restent prioritaires quand elles sont saines.

import Stripe from "npm:stripe@17.7.0";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  assertNotLiveObject as assertNotLiveObjectPure,
  assertTestModeKey,
  isAllowedOrigin as isAllowedOriginPure,
  isAuthorizedCron as isAuthorizedCronPure,
  isTestMode,
  isTestSecretKey,
  webhookSecrets as webhookSecretsPure,
  type Env,
} from "./guards.ts";

export { Stripe };
export { isTestMode } from "./guards.ts";

// Client service_role : bypass RLS, appelle les RPC réservées au backend.
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
}

async function loadEffectiveEnv(): Promise<Env> {
  const env = Deno.env.toObject() as Env;
  const key = (env.STRIPE_SECRET_KEY ?? "").trim();
  if (key && (!isTestMode(env) || isTestSecretKey(key))) return env;
  try {
    const { data, error } = await serviceClient().rpc("get_stripe_config");
    if (!error && data && typeof data === "object") {
      // L'env Stripe est jugé non fiable : la config posée en base par
      // l'opérateur backend prime pour les clés qu'elle définit.
      return { ...env, ...(data as Record<string, string>) };
    }
  } catch (err) {
    console.error("get_stripe_config fallback indisponible", err);
  }
  return env;
}

// Résolue une fois au démarrage de l'isolat (top-level await Deno).
export const effectiveEnv: Env = await loadEffectiveEnv();

const secretKey = (effectiveEnv.STRIPE_SECRET_KEY ?? "").trim();

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

// Garde-fou central : clé présente ET conforme au mode test (refuse sk_live).
// Toutes les fonctions initiées par un utilisateur l'appellent en préambule.
export function assertTestMode(): void {
  assertTestModeKey(effectiveEnv);
}

// Refuse tout objet Stripe livemode=true reçu alors que le mode test est actif.
export function assertNotLive(livemode: boolean | undefined): void {
  assertNotLiveObjectPure(livemode, effectiveEnv);
}

export function isAllowedOrigin(origin: string | null): boolean {
  return isAllowedOriginPure(origin, effectiveEnv);
}

export function webhookSecrets(): string[] {
  return webhookSecretsPure(effectiveEnv);
}

export function isAuthorizedCron(provided: string | null): boolean {
  return isAuthorizedCronPure(provided, effectiveEnv);
}

// CORS : origines autorisées uniquement (audit L3 sur l'ancienne fonction psp).
// L'origine effective renvoyée dans l'en-tête n'est jamais une origine inconnue.
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = isAllowedOrigin(origin) && origin ? origin : "https://app.urosi.fr";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Refuse explicitement une origine non autorisée (renvoie 403), à appeler juste
// après la gestion du OPTIONS dans chaque fonction exposée au navigateur.
export function denyDisallowedOrigin(origin: string | null): Response | null {
  if (isAllowedOrigin(origin)) return null;
  return jsonResponse({ error: "Origine non autorisée." }, 403, origin);
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
  return (effectiveEnv.APP_URL ?? "").trim() || "https://app.urosi.fr";
}
