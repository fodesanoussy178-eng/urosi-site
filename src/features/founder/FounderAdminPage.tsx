import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { hasFounderAccess } from '@/features/auth/authService';
import { FONT, T } from '@/components/ui/theme';
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary';
import { founderButton, founderCard, founderDate } from './founderUi';
import { enterFounderTestMode, listFounderTestAccounts, type FounderTestAccountsList, type FounderTestAccountSummary } from './testMode';
import { describeError } from '@/lib/errors';
import { FounderDashboardPanel } from './panels/FounderDashboardPanel';
import { FounderAccountsPanel } from './panels/FounderAccountsPanel';
import { FounderMissionsPanel } from './panels/FounderMissionsPanel';
import { FounderKycPanel } from './panels/FounderKycPanel';
import { FounderReportsPanel } from './panels/FounderReportsPanel';
import { FounderRatingsPanel } from './panels/FounderRatingsPanel';
import { FounderRevenuePanel } from './panels/FounderRevenuePanel';
import { FounderAuditPanel } from './panels/FounderAuditPanel';
import { FounderLabPanel } from './panels/FounderLabPanel';

const sections = [
  ['dashboard', '📊', 'Vue globale', 'Chiffres clés de la plateforme'],
  ['accounts', '👥', 'Utilisateurs', 'Comptes travailleurs et structures'],
  ['missions', '🧭', 'Missions', 'Interventions et statuts'],
  ['kyc', '🪪', 'KYC', "Dossiers d'identité à traiter"],
  ['reports', '⚠️', 'Signalements', 'Litiges et incidents'],
  ['ratings', '⭐', 'Évaluations', 'Notes travailleurs ↔ structures'],
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
  ratings: FounderRatingsPanel,
  revenue: FounderRevenuePanel,
  audit: FounderAuditPanel,
  lab: FounderLabPanel,
};

export function FounderAdminPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const requested = params.get('section');
  const active: SectionKey | null = sections.some(([key]) => key === requested) ? (requested as SectionKey) : null;

  useEffect(() => {
    if (!session) return;
    hasFounderAccess().then(setAllowed).catch(() => setAllowed(false));
  }, [session]);

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

        {!active && <TestAccountsSwitcher />}

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
            <SectionErrorBoundary label={activeMeta[2]}>
              <ActivePanel />
            </SectionErrorBoundary>
          </div>
        )}
      </main>
    </div>
  );
}

// Bascule vers un compte de test Worker/Structure : plusieurs comptes
// possibles par rôle (bouton « + Nouveau » en crée toujours un nouveau),
// chacun listé avec un bouton « Tester » pour y basculer directement.
// Ces structures de test n'ont jamais besoin d'une vraie carte bancaire
// (voir migration 20260725270000_founder_test_multi_account_and_card_bypass.sql).
function TestAccountsSwitcher() {
  const navigate = useNavigate();
  const [data, setData] = useState<FounderTestAccountsList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await listFounderTestAccounts());
      setLoadError(null);
    } catch (e) {
      setLoadError(describeError(e, 'la liste des comptes de test'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function go(as: 'worker' | 'structure', mode: 'create' | 'switch', accountId: string | undefined, key: string) {
    if (busyKey) return;
    setBusyKey(key);
    setSwitchError(null);
    try {
      await enterFounderTestMode(as, mode, accountId);
      navigate('/app', { replace: true });
    } catch (e) {
      setSwitchError(describeError(e, 'la bascule vers ce mode de test'));
      setBusyKey(null);
    }
  }

  const roles: Array<['worker' | 'structure', string, FounderTestAccountSummary[] | undefined]> = [
    ['worker', '👷 Travailleurs de test', data?.workers],
    ['structure', '🏢 Structures de test', data?.structures],
  ];

  return (
    <div style={{ marginBottom: 18 }}>
      {loadError && <div style={{ ...founderCard, color: T.red, fontSize: 12, marginBottom: 8 }}>{loadError}</div>}
      <div className="rsp-cols-2-lg" style={{ display: 'grid', gap: 10, marginBottom: 8 }}>
        {roles.map(([role, label, accounts]) => {
          const createKey = `create-${role}`;
          return (
            <div key={role} style={founderCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: 12 }}>{label}</strong>
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => go(role, 'create', undefined, createKey)}
                  style={{ ...founderButton, opacity: busyKey && busyKey !== createKey ? 0.5 : 1 }}
                >
                  {busyKey === createKey ? '…' : '+ Nouveau'}
                </button>
              </div>
              {accounts && accounts.length === 0 && (
                <div style={{ fontSize: 11, color: T.mu }}>Aucun compte de test pour l'instant.</div>
              )}
              {(accounts ?? []).map((acc) => (
                <div
                  key={acc.id}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: `1px solid ${T.cb}` }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {acc.structure_name ?? acc.full_name}
                    </div>
                    <div style={{ fontSize: 9, color: T.mu }}>{founderDate(acc.created_at)}</div>
                  </div>
                  <button
                    type="button"
                    disabled={busyKey !== null}
                    onClick={() => go(role, 'switch', acc.id, acc.id)}
                    style={{ ...founderButton, opacity: busyKey && busyKey !== acc.id ? 0.5 : 1, flexShrink: 0 }}
                  >
                    {busyKey === acc.id ? '…' : 'Tester'}
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {switchError && (
        <div style={{ background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 12, padding: 12 }}>
          <div style={{ color: T.red, fontSize: 12, fontWeight: 900, marginBottom: 3 }}>⚠ La bascule a échoué</div>
          <div style={{ color: T.sub, fontSize: 11, lineHeight: 1.5 }}>{switchError} Tu es toujours dans le Centre Fondateur — rien n'a changé.</div>
        </div>
      )}
    </div>
  );
}

function Centered({ text }: { text: string }) {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: T.bg, color: T.sub, fontFamily: FONT }}>{text}</div>;
}
