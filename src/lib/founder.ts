// ⚠️ Confort UI de la DÉMO uniquement. Rien dans ce module n'est une
// décision de sécurité : l'accès fondateur réel est décidé côté serveur par
// la RPC `has_founder_access` (app_metadata `is_founder` ou table
// `founder_access`), cf. FounderAdminPage. Ne jamais ajouter ici d'email ou
// de secret : tout ce fichier est expédié dans le bundle client.
export const FOUNDER_ACCESS_KEY = 'urosi_founder_access_user_v1';
export const DEMO_FOUNDER_ACCESS_KEY = 'urosi_demo_founder_access_v1';

const DEMO_FOUNDER_CODE = [65, 71, 79, 82, 65, 53, 57];

export function isDemoFounderCode(value: string | null | undefined): boolean {
  return (value ?? '').trim().toUpperCase() === String.fromCharCode(...DEMO_FOUNDER_CODE);
}

export function rememberDemoFounderAccess() {
  try {
    localStorage.setItem(DEMO_FOUNDER_ACCESS_KEY, '1');
  } catch {
    // ignore
  }
}

export function hasDemoFounderAccess(): boolean {
  try {
    return localStorage.getItem(DEMO_FOUNDER_ACCESS_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberFounderAccess(userId: string | null | undefined) {
  if (!userId) return;
  try {
    localStorage.setItem(FOUNDER_ACCESS_KEY, userId);
  } catch {
    // ignore
  }
}

export function hasRememberedFounderAccess(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(FOUNDER_ACCESS_KEY) === userId;
  } catch {
    return false;
  }
}
