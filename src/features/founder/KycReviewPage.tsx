import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { hasFounderAccess } from '@/features/auth/authService';
import { T, FONT } from '@/components/ui/theme';
import {
  createKycDocumentUrl,
  decideKyc,
  fetchKycHistory,
  fetchKycSubmissions,
  type KycHistoryEntry,
  type KycSubmission,
} from './kycReviewService';

const KYC_MODE = import.meta.env.VITE_KYC_MODE ?? 'simulation';

function fmt(value: string | null): string {
  return value ? new Date(value).toLocaleString('fr-FR') : '—';
}

export function KycReviewPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<KycSubmission[]>([]);
  const [history, setHistory] = useState<Record<string, KycHistoryEntry[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const submissions = await fetchKycSubmissions();
    setRows(submissions);
    const entries = await Promise.all(submissions.map(async (row) => [row.profile_id, await fetchKycHistory(row.profile_id)] as const));
    setHistory(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const founder = await hasFounderAccess().catch(() => false);
      setAllowed(founder);
      if (founder) await load().catch((e) => setError(e instanceof Error ? e.message : 'Chargement impossible.'));
    })();
  }, [load, session]);

  if (!loading && !session) return <Navigate to="/connexion" replace />;
  if (loading || allowed === null) return <Centered text="Vérification des droits…" />;
  if (!allowed) return <Centered text="Accès fondateur requis." />;

  async function openDocument(row: KycSubmission) {
    if (!row.identity_document_path) return;
    try {
      const url = await createKycDocumentUrl(row.identity_document_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Document inaccessible.');
    }
  }

  async function decide(row: KycSubmission, status: 'verified' | 'rejected') {
    if (KYC_MODE !== 'simulation' || busy) return;
    const reason = status === 'rejected' ? window.prompt('Motif du refus (obligatoire)')?.trim() : undefined;
    if (status === 'rejected' && !reason) return;
    setBusy(row.profile_id);
    setError(null);
    try {
      await decideKyc(row.profile_id, status, reason);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Décision impossible.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: FONT, padding: '24px 16px' }}>
      <main style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>Vérification KYC</div>
            <div style={{ fontSize: 11, color: T.mu }}>Mode {KYC_MODE === 'simulation' ? 'simulation manuelle' : 'prestataire externe'}</div>
          </div>
          <button onClick={() => navigate('/app')} style={smallButton}>← Espace structure</button>
        </div>
        {KYC_MODE !== 'simulation' && (
          <div style={{ ...notice, color: T.amber }}>Les décisions manuelles sont désactivées. Le statut doit venir du webhook du prestataire KYC.</div>
        )}
        {error && <div style={{ ...notice, color: T.red }}>{error}</div>}
        {rows.length === 0 && <div style={notice}>Aucun dossier KYC à traiter.</div>}
        {rows.map((row) => (
          <section key={row.profile_id} style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 900 }}>{row.full_name || 'Travailleur'}</div>
                <div style={{ color: T.mu, fontSize: 10 }}>Soumis : {fmt(row.kyc_submitted_at)}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 800, color: row.kyc_status === 'verified' ? T.green : row.kyc_status === 'rejected' ? T.red : T.cyan }}>
                {row.kyc_status}
              </span>
            </div>
            <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.7 }}>
              IBAN : {row.iban_country ?? '—'} •••• {row.iban_last4 ?? '—'}<br />
              Document : {row.identity_document_name ?? '—'}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => openDocument(row)} disabled={!row.identity_document_path} style={smallButton}>Voir le document (60 s)</button>
              {row.kyc_status === 'submitted' && KYC_MODE === 'simulation' && (
                <>
                  <button onClick={() => decide(row, 'verified')} disabled={busy === row.profile_id} style={{ ...smallButton, color: T.green }}>Vérifier</button>
                  <button onClick={() => decide(row, 'rejected')} disabled={busy === row.profile_id} style={{ ...smallButton, color: T.red }}>Refuser</button>
                </>
              )}
            </div>
            {(history[row.profile_id]?.length ?? 0) > 0 && (
              <div style={{ borderTop: `1px solid ${T.cb}`, marginTop: 12, paddingTop: 10, fontSize: 10, color: T.mu }}>
                {(history[row.profile_id] ?? []).map((entry) => (
                  <div key={entry.id} style={{ marginBottom: 4 }}>
                    {fmt(entry.created_at)} · {entry.previous_status ?? '—'} → {entry.new_status}{entry.reason ? ` · ${entry.reason}` : ''}
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </main>
    </div>
  );
}

function Centered({ text }: { text: string }) {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: T.bg, color: T.sub, fontFamily: FONT }}>{text}</div>;
}

const smallButton = {
  background: T.row,
  border: `1px solid ${T.cb}`,
  borderRadius: 8,
  color: T.text,
  padding: '8px 10px',
  fontSize: 10,
  fontWeight: 800,
  cursor: 'pointer',
} as const;

const notice = {
  background: T.card,
  border: `1px solid ${T.cb}`,
  borderRadius: 10,
  padding: 12,
  marginBottom: 12,
  color: T.sub,
  fontSize: 12,
} as const;
