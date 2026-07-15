import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { hasFounderAccess } from '@/features/auth/authService';
import { FONT, T } from '@/components/ui/theme';
import { founderButton } from './founderUi';
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
  const requested = params.get('section');
  const active: Section = sections.some(([key]) => key === requested) ? requested as Section : 'dashboard';

  useEffect(() => {
    if (!session) return;
    hasFounderAccess().then(setAllowed).catch(() => setAllowed(false));
  }, [session]);

  if (!loading && !session) return <Navigate to="/connexion?next=/fondateur" replace />;
  if (loading || allowed === null) return <Centered text="Vérification des droits…" />;
  if (!allowed) return <Centered text="Accès Fondateur requis." />;

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: FONT, padding: '20px 14px 40px' }}>
      <main style={{ maxWidth: 1040, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
          <div>
            <div style={{ color: T.cyan, fontSize: 10, fontWeight: 900, letterSpacing: 1.3 }}>UROSI · ADMINISTRATION</div>
            <h1 style={{ fontSize: 23, margin: '4px 0 0' }}>Centre Fondateur</h1>
          </div>
          <button onClick={() => navigate('/app')} style={founderButton}>← Retour à l’app</button>
        </header>

        <nav aria-label="Sections Fondateur" style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 10, marginBottom: 12 }}>
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

        {active === 'dashboard' && <FounderDashboardPanel />}
        {active === 'accounts' && <FounderAccountsPanel />}
        {active === 'missions' && <FounderMissionsPanel />}
        {active === 'kyc' && <FounderKycPanel />}
        {active === 'reports' && <FounderReportsPanel />}
        {active === 'revenue' && <FounderRevenuePanel />}
        {active === 'audit' && <FounderAuditPanel />}
        {active === 'lab' && <FounderLabPanel />}
      </main>
    </div>
  );
}

function Centered({ text }: { text: string }) {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: T.bg, color: T.sub, fontFamily: FONT }}>{text}</div>;
}
