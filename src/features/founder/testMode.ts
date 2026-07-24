// Bascule de session pour le mode test Fondateur : le fondateur reste
// l'unique autorité (c'est SA session, authentifiée normalement, qui
// autorise l'appel serveur), mais l'app affiche ensuite les vrais
// composants Worker/Structure comme si un compte de test y était connecté.
//
// Un seul client Supabase existe dans l'app (src/lib/supabase.ts) : basculer
// consiste à remplacer SA session active, après avoir mis de côté celle du
// fondateur pour pouvoir y revenir sans se reconnecter.
import { supabase } from '@/lib/supabase';

const STASH_KEY = 'urosi_founder_stashed_session_v1';

interface StashedSession {
  access_token: string;
  refresh_token: string;
}

interface TestModeResponse {
  token_hash?: string;
  error?: string;
}

export function hasStashedFounderSession(): boolean {
  try {
    return sessionStorage.getItem(STASH_KEY) !== null;
  } catch {
    return false;
  }
}

async function stashCurrentSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) throw new Error('Aucune session Fondateur active à mettre de côté.');
  const stash: StashedSession = { access_token: session.access_token, refresh_token: session.refresh_token };
  sessionStorage.setItem(STASH_KEY, JSON.stringify(stash));
}

async function invokeTestMode(as: 'worker' | 'structure'): Promise<string> {
  const { data, error } = await supabase.functions.invoke<TestModeResponse>('founder-test-mode', { body: { as } });
  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json();
        if (body?.error) message = body.error;
      } catch {
        // garde le message par défaut si le corps n'est pas du JSON exploitable
      }
    }
    throw new Error(message);
  }
  if (!data?.token_hash) throw new Error(data?.error || 'Bascule en mode test impossible.');
  return data.token_hash;
}

/** Passe la session active sur le compte de test worker/structure dédié. */
export async function enterFounderTestMode(as: 'worker' | 'structure'): Promise<void> {
  await stashCurrentSession();
  try {
    const tokenHash = await invokeTestMode(as);
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    if (error) throw error;
  } catch (e) {
    sessionStorage.removeItem(STASH_KEY);
    throw e;
  }
}

/** Restaure la session Fondateur mise de côté avant la bascule. */
export async function exitFounderTestMode(): Promise<void> {
  const raw = sessionStorage.getItem(STASH_KEY);
  if (!raw) throw new Error('Aucune session Fondateur à restaurer — reconnecte-toi.');
  sessionStorage.removeItem(STASH_KEY);
  const stash = JSON.parse(raw) as StashedSession;
  const { error } = await supabase.auth.setSession({ access_token: stash.access_token, refresh_token: stash.refresh_token });
  if (error) throw error;
}
