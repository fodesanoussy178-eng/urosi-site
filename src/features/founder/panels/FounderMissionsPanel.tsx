import { useCallback, useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { founderAdminApi, type FounderMission } from '../founderAdminService';
import { founderButton, founderCard, founderInput, founderNotice } from '../founderUi';
import { describeError } from '@/lib/errors';

export function FounderMissionsPanel() {
  const [rows, setRows] = useState<FounderMission[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setRows(await founderAdminApi.missions(search, status)); setError(''); }
    catch (cause) { setError(describeError(cause, 'le chargement des missions')); }
  }, [search, status]);
  useEffect(() => { void load(); }, [load]);

  async function intervene(row: FounderMission) {
    const next = window.prompt('Nouveau statut : open, closed ou cancelled', row.status)?.trim();
    if (!next || next === row.status) return;
    const reason = window.prompt('Motif de l’intervention (obligatoire)')?.trim();
    if (!reason) return;
    try { await founderAdminApi.setMissionStatus(row.id, next, reason); await load(); }
    catch (cause) { setError(describeError(cause, 'cette intervention sur la mission')); }
  }

  return (
    <section>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 150px', gap: 8, marginBottom: 12 }}>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mission ou structure" style={founderInput} />
        <select value={status} onChange={(event) => setStatus(event.target.value)} style={founderInput}>
          <option value="">Tous les statuts</option><option value="open">Ouverte</option><option value="closed">Terminée</option><option value="cancelled">Annulée</option>
        </select>
      </div>
      {error && <div style={{ ...founderNotice, color: T.red }}>{error}</div>}
      <div style={{ display: 'grid', gap: 9 }}>
        {rows.map((row) => (
          <article key={row.id} style={founderCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div><strong>{row.title}</strong><div style={{ color: T.mu, fontSize: 10 }}>{row.structure_name} · {row.scheduled_date} · {row.category} · {row.participants} participant(s)</div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: T.cyan, fontSize: 11 }}>{row.status} · {Number(row.amount || 0).toFixed(2)} €</span><button onClick={() => intervene(row)} style={founderButton}>Intervenir</button></div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
