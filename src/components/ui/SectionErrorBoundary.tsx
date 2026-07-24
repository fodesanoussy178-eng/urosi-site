import { Component, type ErrorInfo, type ReactNode } from 'react';
import { T } from './theme';

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
}

// Contrairement à ErrorBoundary (global, plein écran), celle-ci isole une
// seule section : si son contenu plante (donnée manquante, appel en échec…),
// le reste de l'écran continue de fonctionner normalement au lieu de tout
// remplacer par l'écran de secours plein écran.
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`UROSI crash (section${this.props.label ? `: ${this.props.label}` : ''}):`, error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 14, padding: 15 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: T.red, marginBottom: 5 }}>
          {this.props.label ? `« ${this.props.label} » n'a pas pu s'afficher.` : "Cette section n'a pas pu s'afficher."}
        </div>
        <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5, marginBottom: 10 }}>
          Le reste de la page fonctionne normalement.
        </div>
        <button
          onClick={() => this.setState({ hasError: false })}
          style={{ background: '#fff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
        >
          Réessayer
        </button>
      </div>
    );
  }
}
