import type { ReactNode } from 'react';
import { T } from './theme';

// Champ de formulaire du prototype : label uppercase discret + contenu.
export function Fld({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}
