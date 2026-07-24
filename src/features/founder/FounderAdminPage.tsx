import { useEffect, useState, type ComponentType } from 'react';
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
  ['dashboard', '📊', 'Vue globale', 'Chiffres clés de la plateforme'],
  ['accounts', '👥', 'Utilisateurs', 'Comptes travailleurs et structures'],
  ['missions', '🧭', 'Missions', 'Interventions et statuts'],
  ['kyc', '🪪', 'KYC', "Dossiers d'identité à traiter"],
  ['reports', '⚠️', 'Signalements', 'Litiges et incidents'],
  ['revenue', '💶', 'Revenus', 'Commissions UROSI'],
  ['audit', '📜', 'Journal', 'Historique des actions'],
  ['lab', '🧪', 'Laboratoire', 'Scénarios de test internes'],
] as const;

type SectionKey = (typeof sections)[number][0];

const PANELS: Record<SectionKey, ComponentType> = {
  dashboard: FounderDashboardPanel,
  accounts: FounderAccountsPanel,
  missions: FounderMissionsPanel,
  kyc: FounderKycPanel,
  reports: FounderReportsPanel,
  revenue: FounderRevenuePanel,
  audit: FounderAuditPanel,
  lab: FounderLabPanel,
};

export function FounderAdminPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [switching, setSwitching] = useState<'worker' | 'structure' | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const requested = params.get('section');
  const active: SectionKey | null = sections.some(([key]) => key === requested) ? (requested as SectionKey) : null;

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

  const ActivePanel = active ? PANELS[active] : null;
  const activeMeta = active ? sections.find(([key]) => key === active) : null;

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: FONT, padding: '20px 14px 40px' }}>
      <main className="rsp-founder-main" style={{ maxWidth: 900, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ color: T.cyan, fontSize: 10, fontWeight: 900, letterSpacing: 1.3 }}>UROSI · ADMINISTRATION</div>
            <h1 style={{ fontSize: 21, margin: '4px 0 0' }}>Centre Fondateur</h1>
          </div>
          <button onClick={() => navigate('/app')} style={founderButton}>← Mon compte</button>
        </header>

        {/* Sélecteur de mode : seul choix visible en haut, jamais de petits
            boutons secondaires à côté — basculer remplace toute l'interface. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 18 }}>
          <button
            type="button"
            disabled={switching !== null}
            onClick={() => testAs('worker')}
            style={{ ...bigModeButton, opacity: switching && switching !== 'worker' ? 0.5 : 1 }}
          >
            <span style={{ fontSize: 20 }}>👷</span>
            <span>{switching === 'worker' ? '…' : 'Tester comme Worker'}</span>
          </button>
          <button
            type="button"
            disabled={switching !== null}
            onClick={() => testAs('structure')}
            style={{ ...bigModeButton, opacity: switching && switching !== 'structure' ? 0.5 : 1 }}
          >
            <span style={{ fontSize: 20 }}>🏢</span>
            <span>{switching === 'structure' ? '…' : 'Tester comme Structure'}</span>
          </button>
          <button type="button" disabled style={{ ...bigModeButton, background: T.text, color: T.bg, cursor: 'default' }}>
            <span style={{ fontSize: 20 }}>🛡</span>
            <span>Mode Admin</span>
          </button>
        </div>
        {switchError && <div style={{ color: T.red, fontSize: 11, marginBottom: 14 }}>{switchError}</div>}

        {!active && (
          <div className="rsp-cols-2-lg" style={{ display: 'grid', gap: 10 }}>
            {sections.map(([key, icon, label, description]) => (
              <button
                key={key}
                type="button"
                onClick={() => setParams({ section: key })}
                style={{
                  textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
                  background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14,
                  padding: '15px 16px', cursor: 'pointer', color: T.text,
                }}
              >
                <span style={{ fontSize: 24, flexShrink: 0 }}>{icon}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 900 }}>{label}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: T.mu, marginTop: 2 }}>{description}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {active && ActivePanel && activeMeta && (
          <div>
            <button
              type="button"
              onClick={() => setParams({})}
              style={{ ...founderButton, marginBottom: 14 }}
            >
              ← Retour
            </button>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>{activeMeta[1]} {activeMeta[2]}</h2>
            <ActivePanel />
          </div>
        )}
      </main>
    </div>
  );
}

const bigModeButton = {
  display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 5,
  background: T.row, border: `1px solid ${T.cb}`, borderRadius: 12,
  padding: '13px 6px', cursor: 'pointer', color: T.text, fontSize: 10.5, fontWeight: 800,
  textAlign: 'center' as const,
};

function Centered({ text }: { text: string }) {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: T.bg, color: T.sub, fontFamily: FONT }}>{text}</div>;
}
