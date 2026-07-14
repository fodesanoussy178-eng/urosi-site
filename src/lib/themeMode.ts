export type ThemeMode = 'dark' | 'light';

const THEME_KEY = 'urosi_theme_v1';

export function readThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Le stockage peut être indisponible en navigation privée stricte.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyThemeMode(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
}

export function saveThemeMode(mode: ThemeMode) {
  applyThemeMode(mode);
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Le thème reste actif pour la session courante.
  }
}
