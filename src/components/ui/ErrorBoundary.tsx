import { Component, type ErrorInfo, type ReactNode } from 'react';
import { T, FONT } from '@/components/ui/theme';

// Un nouveau déploiement change le nom (hashé) des fichiers JS : un onglet
// resté ouvert depuis avant le déploiement échoue à charger un chunk
// devenu obsolète (route chargée à la demande, cf. lazy() dans App.tsx).
// Ce n'est pas un bug de code — un simple rechargement récupère la
// dernière version. On le détecte pour recharger une seule fois, sans
// jamais boucler si le rechargement ne résout rien.
const RELOAD_GUARD_KEY = 'urosi_chunk_reload_guard';

function isChunkLoadError(error: Error): boolean {
  const message = error.message || '';
  return /dynamically imported module|Loading chunk|Failed to fetch dynamically|error loading dynamically imported module|ChunkLoadError/i.test(message);
}

// Filet de sécurité contre les pages blanches : toute erreur de rendu non
// rattrapée affiche un écran de reprise au lieu d'un écran vide.
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; reloading: boolean }> {
  state = { hasError: false, reloading: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidMount(): void {
    // Rendu initial réussi : une éventuelle erreur passée n'a plus lieu
    // d'être, on autorise à nouveau un futur auto-rechargement si besoin.
    try {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch {
      // ignore
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UROSI crash:', error, info.componentStack);
    if (isChunkLoadError(error)) {
      try {
        if (!sessionStorage.getItem(RELOAD_GUARD_KEY)) {
          sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
          this.setState({ reloading: true });
          window.location.reload();
        }
      } catch {
        // sessionStorage indisponible : laisse l'écran de reprise s'afficher
      }
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    if (this.state.reloading) {
      return (
        <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: T.sub, fontSize: 13 }}>
          Mise à jour de l'application…
        </div>
      );
    }
    return (
      <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <div style={{ fontSize: 34, marginBottom: 12 }}>😵</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: T.text, marginBottom: 6 }}>Oups, un pépin d'affichage</div>
          <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.6, marginBottom: 18 }}>
            Rien de grave : ton compte et tes données sont intacts. Recharge la page pour reprendre.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ background: '#fff', color: '#000', border: 'none', borderRadius: 10, padding: '12px 26px', fontSize: 13, fontWeight: 900, cursor: 'pointer' }}
          >
            Recharger
          </button>
          <div>
            <button
              onClick={() => window.location.assign('/')}
              style={{ marginTop: 12, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.mu, textDecoration: 'underline' }}
            >
              ← Retour à l'accueil
            </button>
          </div>
        </div>
      </div>
    );
  }
}
