export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Clé publishable Stripe (non sensible, exposable côté client). La clé secrète
// et le secret webhook restent uniquement dans les secrets des Edge Functions.
export const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
export const isStripeConfigured = Boolean(stripePublishableKey);
