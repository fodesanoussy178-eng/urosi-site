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

export type FounderTestMode = 'create' | 'switch';

export interface FounderTestAccountSummary {
  id: string;
  full_name: string;
  email: string;
  created_at: string;
  structure_id?: string;
  structure_name?: string;
}

export interface FounderTestAccountsList {
  workers: FounderTestAccountSummary[];
  structures: FounderTestAccountSummary[];
}

/** Liste tous les comptes de test Fondateur existants (workers + structures). */
export async function listFounderTestAccounts(): Promise<FounderTestAccountsList> {
  const { data, error } = await supabase.rpc('founder_test_accounts_list');
  if (error) throw new Error(error.message);
  return (data as unknown as FounderTestAccountsList) ?? { workers: [], structures: [] };
}

/**
 * Renomme un compte de test existant. Pour un worker, modifie son
 * full_name ; pour une structure, modifie le nom de la structure (l'identité
 * réellement affichée/testée pour ce rôle).
 */
export async function renameFounderTestAccount(as: 'worker' | 'structure', accountId: string, name: string): Promise<void> {
  const { error } = await supabase.rpc('founder_rename_test_account', {
    p_account_id: accountId,
    p_as: as,
    p_name: name,
  });
  if (error) throw new Error(error.message);
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

export interface FounderTestCreateOptions {
  /** Uniquement pour créer une structure : type de la mission auto-créée (par défaut rémunérée). Ignoré si provisionNow=false. */
  isSolidaire?: boolean;
  /**
   * Uniquement pour créer une structure (par défaut true) : si false, la
   * structure n'est PAS auto-provisionnée/vérifiée — le compte atterrit sur
   * le vrai formulaire d'inscription (nom + SIRET) de l'appli réelle, avec
   * son bouton de bypass réservé aux comptes de test.
   */
  provisionNow?: boolean;
}

async function invokeTestMode(
  as: 'worker' | 'structure',
  mode: FounderTestMode,
  accountId?: string,
  options?: FounderTestCreateOptions,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke<TestModeResponse>('founder-test-mode', {
    body: {
      as,
      mode,
      account_id: accountId,
      is_solidaire: options?.isSolidaire,
      provision_now: options?.provisionNow,
    },
  });
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

/**
 * Passe la session active sur un compte de test worker/structure.
 * mode='create' en crée toujours un nouveau ; mode='switch' (défaut) bascule
 * vers un compte de test existant (accountId requis dans ce cas).
 * options : uniquement utilisées en mode='create' (voir FounderTestCreateOptions).
 */
export async function enterFounderTestMode(
  as: 'worker' | 'structure',
  mode: FounderTestMode = 'switch',
  accountId?: string,
  options?: FounderTestCreateOptions,
): Promise<void> {
  await stashCurrentSession();
  try {
    const tokenHash = await invokeTestMode(as, mode, accountId, options);
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    if (error) throw error;
  } catch (e) {
    sessionStorage.removeItem(STASH_KEY);
    throw e;
  }
}

/** Supprime définitivement un compte de test (worker ou structure) et tout ce qui en dépend. */
export async function deleteFounderTestAccount(as: 'worker' | 'structure', accountId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<TestModeResponse>('founder-test-mode', {
    body: { as, mode: 'delete', account_id: accountId },
  });
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
  if (data?.error) throw new Error(data.error);
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
