import { Component, type ErrorInfo, type ReactNode } from 'react';
import { T, FONT } from '@/components/ui/theme';

// Filet de sécurité contre les pages blanches : toute erreur de rendu non
// rattrapée affiche un écran de reprise au lieu d'un écran vide.
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UROSI crash:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
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
