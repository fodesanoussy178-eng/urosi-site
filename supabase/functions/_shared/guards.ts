// Gardes de sécurité « mode test » — fonctions PURES, sans import Deno/npm.
//
// Ce module est volontairement dépourvu de dépendances runtime afin d'être
// importable à la fois par les Edge Functions Deno (`./guards.ts`) et par la
// suite de tests Vitest côté Node (`guards.test.ts`). Il centralise les refus
// exigés par la phase 1 :
//   - refus d'une clé secrète `sk_live…` tant que le mode test est actif ;
//   - refus d'un objet Stripe `livemode=true` en mode test ;
//   - refus d'une origine (CORS) non autorisée ;
//   - sélection des secrets de signature webhook (Connect + Compte + legacy) ;
//   - validation du secret de déclenchement cron (`STRIPE_CRON_SECRET`).
//
// Rien ici ne parle à Stripe : ce sont des vérifications déterministes.

export type Env = Record<string, string | undefined>;

/** Clé secrète Stripe de production (à refuser tant que le mode test est actif). */
export function isLiveSecretKey(key: string | undefined): boolean {
  return typeof key === "string" && (key.startsWith("sk_live") || key.startsWith("rk_live"));
}

/** Clé secrète Stripe de test (seule autorisée en mode test). */
export function isTestSecretKey(key: string | undefined): boolean {
  return typeof key === "string" && (key.startsWith("sk_test") || key.startsWith("rk_test"));
}

/**
 * Mode test actif ? Par défaut OUI (fail-safe) : il faut positionner
 * explicitement `STRIPE_TEST_MODE=false` (ou `0`/`live`/`off`) pour passer en
 * live — ce qui relève de la phase 2, jamais d'un oubli de configuration.
 */
export function isTestMode(env: Env): boolean {
  const flag = (env.STRIPE_TEST_MODE ?? "true").trim().toLowerCase();
  return flag !== "false" && flag !== "0" && flag !== "live" && flag !== "off" && flag !== "no";
}

/**
 * Vérifie la clé secrète configurée. Lève une erreur si, en mode test, la clé
 * est une clé live ou n'est pas une clé de test. C'est le garde-fou central qui
 * garantit qu'aucune opération réelle ne peut partir d'un environnement de test.
 */
export function assertTestModeKey(env: Env): void {
  const key = (env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY absent : configurez les secrets Supabase.");
  }
  if (isTestMode(env)) {
    if (isLiveSecretKey(key)) {
      throw new Error("Refus : clé Stripe live détectée alors que STRIPE_TEST_MODE est actif.");
    }
    if (!isTestSecretKey(key)) {
      throw new Error("Refus : STRIPE_SECRET_KEY doit être une clé de test (sk_test_…) en mode test.");
    }
  }
}

/**
 * Refuse un objet Stripe `livemode=true` reçu alors que le mode test est actif
 * (webhook rejoué depuis la production, mauvaise destination, etc.).
 */
export function assertNotLiveObject(livemode: boolean | undefined, env: Env): void {
  if (isTestMode(env) && livemode === true) {
    throw new Error("Refus : objet Stripe livemode=true reçu en mode test.");
  }
}

/** Origines CORS autorisées (statiques + preview injectée par l'environnement). */
export function allowedOrigins(env: Env): Set<string> {
  const origins = [
    "https://urosi.fr",
    "https://www.urosi.fr",
    "https://app.urosi.fr",
    "http://localhost:5173",
    "http://localhost:4173",
  ];
  // `STRIPE_PREVIEW_ORIGIN` peut lister plusieurs origines séparées par des virgules.
  const preview = env.STRIPE_PREVIEW_ORIGIN;
  if (preview) {
    for (const o of preview.split(",").map((s) => s.trim()).filter(Boolean)) {
      origins.push(o);
    }
  }
  return new Set(origins);
}

/**
 * Origine autorisée ? En mode test uniquement, les déploiements Vercel Preview
 * (`https://<slug>.vercel.app`) sont tolérés pour permettre les tests bout-en-bout.
 */
export function isAllowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  if (allowedOrigins(env).has(origin)) return true;
  if (isTestMode(env) && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

/**
 * Secrets de signature à essayer pour vérifier un webhook. Deux destinations
 * Stripe (« Comptes connectés » et « Votre compte ») pointent vers la même URL
 * mais possèdent chacune leur propre secret ; on essaie donc les deux, plus
 * l'ancien secret unique pour la rétrocompatibilité.
 */
export function webhookSecrets(env: Env): string[] {
  return [
    env.STRIPE_CONNECT_WEBHOOK_SECRET,
    env.STRIPE_ACCOUNT_WEBHOOK_SECRET,
    env.STRIPE_WEBHOOK_SECRET, // rétrocompatibilité (déploiement mono-webhook)
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
}

/**
 * Le déclenchement de `release-due-payments` est réservé au backend. On accepte
 * la clé `service_role` (planificateur historique) OU le `STRIPE_CRON_SECRET`
 * dédié. Tout autre secret est refusé.
 */
export function isAuthorizedCron(provided: string | null, env: Env): boolean {
  const value = (provided ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!value) return false;
  const serviceRole = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const cronSecret = (env.STRIPE_CRON_SECRET ?? "").trim();
  if (serviceRole && value === serviceRole) return true;
  if (cronSecret && value === cronSecret) return true;
  return false;
}
