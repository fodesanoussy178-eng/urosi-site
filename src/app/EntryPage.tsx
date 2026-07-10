import { useNavigate } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { T, FONT } from '@/components/ui/theme';

export function EntryPage() {
  const nav = useNavigate();
  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: 16 }}>
      <div style={{ width: 300, textAlign: 'center' }}>
        <div style={{ marginBottom: 28 }}>
          <Logo sz={78} />
        </div>
        <div style={{ fontSize: 12, color: T.mu, marginBottom: 30 }}>Micro-missions · Métropole de Lille</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={() => nav('/inscription/travailleur')}
            style={{ textAlign: 'left', padding: '16px 17px', borderRadius: 13, border: `1.5px solid ${T.cb}`, background: T.card, cursor: 'pointer' }}
          >
            <div style={{ fontSize: 19, marginBottom: 5 }}>👷</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text, marginBottom: 2 }}>Je cherche des missions</div>
            <div style={{ fontSize: 12, color: T.mu }}>Trouver du travail flexible près de chez moi</div>
          </button>
          <button
            onClick={() => nav('/inscription/structure')}
            style={{ textAlign: 'left', padding: '16px 17px', borderRadius: 13, border: 'none', background: T.grad, cursor: 'pointer' }}
          >
            <div style={{ fontSize: 19, marginBottom: 5 }}>🏢</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 2 }}>Je cherche des renforts</div>
            <div style={{ fontSize: 12, color: '#bfdbfe' }}>Publier des missions, gérer mes candidats</div>
          </button>
        </div>
        <button
          onClick={() => nav('/connexion')}
          style={{ marginTop: 22, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: T.sub, textDecoration: 'underline', fontWeight: 700 }}
        >
          Déjà un compte ? Se connecter
        </button>
      </div>
    </div>
  );
}
