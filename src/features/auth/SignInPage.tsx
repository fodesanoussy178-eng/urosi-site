import { useNavigate } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { T, FONT } from '@/components/ui/theme';
import { SignInForm } from './SignInForm';

export function SignInPage() {
  const nav = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT, padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontWeight: 900, fontSize: 15, color: T.text }}>Connexion</span>
          <button onClick={() => nav('/')} style={{ fontSize: 10, color: T.mu, background: 'none', border: `1px solid ${T.cb}`, borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }}>
            ← Accueil
          </button>
        </div>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Logo sz={54} />
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 17 }}>
          <SignInForm />
          <button
            onClick={() => nav('/')}
            style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: T.sub, textDecoration: 'underline', padding: '12px 0 0', fontWeight: 700 }}
          >
            Pas encore de compte ? S'inscrire
          </button>
        </div>
      </div>
    </div>
  );
}
