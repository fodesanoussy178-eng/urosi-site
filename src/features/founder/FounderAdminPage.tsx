import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { hasFounderAccess } from '@/features/auth/authService';
import { FONT, T } from '@/components/ui/theme';
import { founderButton } from './founderUi';
import { enterFounderTestMode } from './testMode';
import { FounderDashboardPanel } from './panels/FounderDashboardPanel';
import { FounderAccountsPanel } from './panels/FounderAccountsPanel';
import { FounderMissionsPanel } from './panels/FounderMissionsPanel';
import { FounderKycPanel } from './panels/FounderKycPanel';
import { FounderReportsPanel } from './panels/FounderReportsPanel';
import { FounderRevenuePanel } from './panels/FounderRevenuePanel';
import { FounderAuditPanel } from './panels/FounderAuditPanel';
import { FounderLabPanel } from './panels/FounderLabPanel';

const sections = [
  ['dashboard', 'Tableau de bord'],
  ['accounts', 'Comptes'],
  ['missions', 'Missions'],
  ['kyc', 'KYC'],
  ['reports', 'Signalements'],
  ['revenue', 'Revenus UROSI'],
  ['audit', 'Journal'],
  ['lab', 'Laboratoire'],
] as const;

type Section = (typeof sections)[number][0];

export function FounderAdminPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [switching, setSwitching] = useState<'worker' | 'structure' | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const requested = params.get('section');
  const active: Section = sections.some(([key]) => key === requested) ? requested as Section : 'dashboard';

  useEffect(() => {
    if (!session) return;
    hasFounderAccess().then(setAllowed).catch(() => setAllowed(false));
  }, [session]);

  async function testAs(as: 'worker' | 'structure') {
    if (switching) return;
    setSwitching(as);
    setSwitchError(null);
    try {
      await enterFounderTestMode(as);
      navigate('/app', { replace: true });
    } catch (e) {
      setSwitchError(e instanceof Error ? e.message : 'Bascule impossible.');
      setSwitching(null);
    }
  }

  if (!loading && !session) return <Navigate to="/connexion?next=/fondateur" replace />;
  if (loading || allowed === null) return <Centered text="Vérification des droits…" />;
  if (!allowed) return <Centered text="Accès Fondateur requis." />;

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: FONT, padding: '20px 14px 40px' }}>
      <main className="rsp-founder-main" style={{ maxWidth: 1040, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
          <div>
            <div style={{ color: T.cyan, fontSize: 10, fontWeight: 900, letterSpacing: 1.3 }}>UROSI · ADMINISTRATION</div>
            <h1 style={{ fontSize: 23, margin: '4px 0 0' }}>Centre Fondateur</h1>
          </div>
          <button onClick={() => navigate('/app')} style={founderButton}>← Retour à l’app</button>
        </header>

        <div style={{ background: T.row, border: `1px solid #7c2d12`, borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 10.5, fontWeight: 900, color: T.text, marginBottom: 3 }}>Mode Fondateur — Tester comme</div>
          <div style={{ fontSize: 9.5, color: T.mu, lineHeight: 1.5, marginBottom: 10 }}>
            Bascule sur un compte de test dédié (worker ou structure), avec les vrais écrans et les vraies règles UROSI. Données isolées, jamais mêlées à un vrai utilisateur.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
            <button type="button" disabled={switching !== null} onClick={() => testAs('worker')} style={{ ...founderButton, opacity: switching && switching !== 'worker' ? 0.5 : 1 }}>
              {switching === 'worker' ? '…' : '👷 Worker'}
            </button>
            <button type="button" disabled={switching !== null} onClick={() => testAs('structure')} style={{ ...founderButton, opacity: switching && switching !== 'structure' ? 0.5 : 1 }}>
              {switching === 'structure' ? '…' : '🏢 Structure'}
            </button>
            <button type="button" disabled style={{ ...founderButton, opacity: 0.6, cursor: 'default' }}>
              🛡 Admin (ici)
            </button>
          </div>
          {switchError && <div style={{ color: T.red, fontSize: 10.5, marginTop: 9 }}>{switchError}</div>}
        </div>

        <nav className="rsp-founder-nav" aria-label="Sections Fondateur" style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 10, marginBottom: 12 }}>
          {sections.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setParams(key === 'dashboard' ? {} : { section: key })}
              style={{ ...founderButton, flex: '0 0 auto', background: active === key ? T.text : T.row, color: active === key ? T.bg : T.sub }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div>
          {active === 'dashboard' && <FounderDashboardPanel />}
          {active === 'accounts' && <FounderAccountsPanel />}
          {active === 'missions' && <FounderMissionsPanel />}
          {active === 'kyc' && <FounderKycPanel />}
          {active === 'reports' && <FounderReportsPanel />}
          {active === 'revenue' && <FounderRevenuePanel />}
          {active === 'audit' && <FounderAuditPanel />}
          {active === 'lab' && <FounderLabPanel />}
        </div>
      </main>
    </div>
  );
}

function Centered({ text }: { text: string }) {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: T.bg, color: T.sub, fontFamily: FONT }}>{text}</div>;
}
