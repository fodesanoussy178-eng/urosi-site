import { useCallback, useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { founderAdminApi, type FounderReport } from '../founderAdminService';
import { founderButton, founderCard, founderDate, founderInput, founderNotice } from '../founderUi';

const actions = [
  ['classify', 'Classer'],
  ['request_information', 'Demander des informations'],
  ['warn', 'Avertir'],
  ['suspend', 'Suspendre temporairement'],
  ['reactivate', 'Réactiver'],
] as const;

export function FounderReportsPanel() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<FounderReport[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try { setRows(await founderAdminApi.reports(status)); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chargement impossible.'); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  async function act(row: FounderReport, action: string) {
    const requiresNote = ['request_information', 'warn', 'suspend'].includes(action);
    const note = window.prompt(requiresNote ? 'Note obligatoire' : 'Note facultative')?.trim();
    if (requiresNote && !note) return;
    setBusy(row.id);
    try { await founderAdminApi.actOnReport(row.id, action, note); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Action impossible.'); }
    finally { setBusy(''); }
  }

  return (
    <section>
      <select value={status} onChange={(event) => setStatus(event.target.value)} style={{ ...founderInput, maxWidth: 230, marginBottom: 12 }}>
        <option value="">Tous les signalements</option><option value="open">Ouverts</option><option value="awaiting_response">En attente</option><option value="reviewing">En traitement</option><option value="resolved">Classés</option>
      </select>
      {error && <div style={{ ...founderNotice, color: T.red }}>{error}</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map((row) => (
          <article key={row.id} style={{ ...founderCard, borderColor: row.severity === 'critical' ? T.red : T.cb }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>{row.category} · {row.target_name}</strong><span style={{ color: T.cyan, fontSize: 10 }}>{row.status}</span></div>
            <div style={{ color: T.mu, fontSize: 10, marginTop: 4 }}>{row.mission_title} · {founderDate(row.created_at)} · gravité {row.severity}</div>
            {row.description && <p style={{ color: T.sub, fontSize: 12 }}>{row.description}</p>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {actions.map(([key, label]) => <button key={key} disabled={busy === row.id} onClick={() => act(row, key)} style={founderButton}>{label}</button>)}
            </div>
            {row.history.map((entry) => <div key={entry.id} style={{ borderTop: `1px solid ${T.cb}`, paddingTop: 7, marginTop: 7, color: T.mu, fontSize: 10 }}>{founderDate(entry.created_at)} · {entry.action}{entry.note ? ` · ${entry.note}` : ''}</div>)}
          </article>
        ))}
      </div>
    </section>
  );
}
