import { T } from '@/components/ui/theme';

export type AuthMode = 'signin' | 'signup';

// Bascule "J'ai deja un compte" / "M'inscrire" en tete des ecrans d'acces,
// presente a l'identique cote travailleur et cote structure.
export function AuthTabs({ mode, onChange }: { mode: AuthMode; onChange: (m: AuthMode) => void }) {
  const tabs: [AuthMode, string][] = [
    ['signin', "J'ai déjà un compte"],
    ['signup', "M'inscrire"],
  ];
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
      {tabs.map(([k, l]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          style={{
            flex: 1,
            background: mode === k ? '#fff' : T.row,
            color: mode === k ? '#000' : T.sub,
            border: `1px solid ${mode === k ? '#fff' : T.cb}`,
            borderRadius: 9,
            padding: '9px 0',
            fontSize: 12,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
