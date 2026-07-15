import { useCallback, useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { founderAdminApi } from '../founderAdminService';
import { founderButton, founderCard, founderDate, founderNotice } from '../founderUi';
import {
  createKycDocumentUrl,
  decideKyc,
  fetchKycHistory,
  fetchKycSubmissions,
  type KycHistoryEntry,
  type KycSubmission,
} from '../kycReviewService';

const KYC_MODE = import.meta.env.VITE_KYC_MODE ?? 'simulation';

export function FounderKycPanel() {
  const [rows, setRows] = useState<KycSubmission[]>([]);
  const [history, setHistory] = useState<Record<string, KycHistoryEntry[]>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const submissions = await fetchKycSubmissions();
    setRows(submissions);
    const entries = await Promise.all(submissions.map(async (row) => [row.profile_id, await fetchKycHistory(row.profile_id)] as const));
    setHistory(Object.fromEntries(entries));
  }, []);
  useEffect(() => { load().catch((cause) => setError(cause instanceof Error ? cause.message : 'Chargement impossible.')); }, [load]);

  async function openDocument(row: KycSubmission) {
    if (!row.identity_document_path) return;
    try { window.open(await createKycDocumentUrl(row.identity_document_path), '_blank', 'noopener,noreferrer'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Document inaccessible.'); }
  }

  async function decide(row: KycSubmission, status: 'verified' | 'rejected') {
    const reason = status === 'rejected' ? window.prompt('Motif du refus (obligatoire)')?.trim() : undefined;
    if (status === 'rejected' && !reason) return;
    setBusy(row.profile_id);
    try { await decideKyc(row.profile_id, status, reason); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Décision impossible.'); }
    finally { setBusy(''); }
  }

  async function requestDocument(row: KycSubmission) {
    const reason = window.prompt('Quel nouveau document faut-il fournir ?')?.trim();
    if (!reason) return;
    setBusy(row.profile_id);
    try { await founderAdminApi.requestKycDocument(row.profile_id, reason); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Demande impossible.'); }
    finally { setBusy(''); }
  }

  return (
    <section>
      <div style={{ ...founderNotice, marginBottom: 10, color: KYC_MODE === 'simulation' ? T.amber : T.green }}>
        Mode KYC : {KYC_MODE === 'simulation' ? 'simulation manuelle' : 'prestataire externe'}. Les documents sont ouverts par URL privée valable 60 secondes.
      </div>
      {error && <div style={{ ...founderNotice, color: T.red, marginBottom: 10 }}>{error}</div>}
      {rows.length === 0 && <div style={founderNotice}>Aucun dossier KYC à traiter.</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map((row) => (
          <article key={row.profile_id} style={founderCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <div><strong>{row.full_name || 'Travailleur'}</strong><div style={{ color: T.mu, fontSize: 10 }}>Soumis : {founderDate(row.kyc_submitted_at)}</div></div>
              <span style={{ color: row.kyc_status === 'verified' ? T.green : row.kyc_status === 'rejected' ? T.red : T.cyan, fontSize: 10, fontWeight: 900 }}>{row.kyc_status}</span>
            </div>
            <div style={{ fontSize: 11, color: T.sub, marginTop: 10 }}>IBAN {row.iban_country ?? '—'} •••• {row.iban_last4 ?? '—'} · {row.identity_document_name ?? 'Aucun document'}</div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 }}>
              <button disabled={!row.identity_document_path} onClick={() => openDocument(row)} style={founderButton}>Voir le document</button>
              {row.kyc_status === 'submitted' && KYC_MODE === 'simulation' && <button disabled={busy === row.profile_id} onClick={() => decide(row, 'verified')} style={{ ...founderButton, color: T.green }}>Accepter</button>}
              {row.kyc_status === 'submitted' && KYC_MODE === 'simulation' && <button disabled={busy === row.profile_id} onClick={() => decide(row, 'rejected')} style={{ ...founderButton, color: T.red }}>Refuser</button>}
              {(row.kyc_status === 'submitted' || row.kyc_status === 'rejected') && <button disabled={busy === row.profile_id} onClick={() => requestDocument(row)} style={founderButton}>Demander un nouveau document</button>}
            </div>
            {(history[row.profile_id] ?? []).map((entry) => (
              <div key={entry.id} style={{ borderTop: `1px solid ${T.cb}`, marginTop: 8, paddingTop: 8, fontSize: 10, color: T.mu }}>
                {founderDate(entry.created_at)} · {entry.previous_status ?? '—'} → {entry.new_status}{entry.reason ? ` · ${entry.reason}` : ''}
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}
