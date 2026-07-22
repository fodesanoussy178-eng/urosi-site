export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Clé publishable Stripe (non sensible, exposable côté client). La clé secrète
// et le secret webhook restent uniquement dans les secrets des Edge Functions.
export const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

// Interrupteur Stripe côté client : l'UI de paiement ne s'active que si
// VITE_STRIPE_ENABLED=true (Vercel Preview en phase de test, Production en phase 2).
export const stripeEnabled = (import.meta.env.VITE_STRIPE_ENABLED as string | undefined) === 'true';

// 'test' (par défaut) ou 'live'. En mode test, une clé publishable qui n'est pas
// pk_test_… est refusée : miroir client du garde serveur assertTestModeKey.
export const stripeEnvironment =
  (import.meta.env.VITE_STRIPE_ENVIRONMENT as string | undefined) ?? 'test';

export const isStripeConfigured =
  Boolean(stripePublishableKey) &&
  stripeEnabled &&
  (stripeEnvironment !== 'test' || Boolean(stripePublishableKey?.startsWith('pk_test')));
