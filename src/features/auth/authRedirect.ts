// Conserve, le temps d'une connexion, la page d'origine d'un lien public
// (ex. /scan/:token ouvert par un QR) pour y revenir apres authentification
// au lieu de retomber sur /app. sessionStorage : ne survit pas au-dela de
// l'onglet, et consumeStoredAuthRedirect() le vide des sa lecture (usage
// unique, jamais reutilise pour une connexion ulterieure sans rapport).
const KEY = 'urosi:post-auth-redirect';

function isSafePath(value: string | null): value is string {
  return !!value && value.startsWith('/') && !value.startsWith('//');
}

export function setStoredAuthRedirect(pathname: string): void {
  if (!isSafePath(pathname)) return;
  try {
    sessionStorage.setItem(KEY, pathname);
  } catch {
    // Stockage indisponible (navigation privee, quota) : le parametre ?next
    // pris en charge par SignInForm reste le filet de secours.
  }
}

export function consumeStoredAuthRedirect(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return isSafePath(value) ? value : null;
  } catch {
    return null;
  }
}
