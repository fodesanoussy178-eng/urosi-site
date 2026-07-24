import { useCallback, useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { founderAdminApi, type AccountHistory, type FounderAccounts } from '../founderAdminService';
import { founderButton, founderCard, founderDate, founderInput, founderNotice } from '../founderUi';
import { describeError } from '@/lib/errors';

export function FounderAccountsPanel() {
  const [search, setSearch] = useState('');
  const [data, setData] = useState<FounderAccounts>({ profiles: [], structures: [] });
  const [history, setHistory] = useState<{ id: string; data: AccountHistory } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setData(await founderAdminApi.accounts(search)); }
    catch (reason) { setError(describeError(reason, 'le chargement des comptes')); }
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  async function toggle(profileId: string, current: 'active' | 'suspended') {
    const next = current === 'active' ? 'suspended' : 'active';
    const reason = next === 'suspended' ? window.prompt('Motif de la suspension (obligatoire)')?.trim() : undefined;
    if (next === 'suspended' && !reason) return;
    setBusy(profileId);
    try { await founderAdminApi.setAccountStatus(profileId, next, reason); await load(); }
    catch (cause) { setError(describeError(cause, 'cette action sur le compte')); }
    finally { setBusy(''); }
  }

  async function openHistory(profileId: string) {
    setBusy(profileId);
    try { setHistory({ id: profileId, data: await founderAdminApi.accountHistory(profileId) }); }
    catch (cause) { setError(describeError(cause, "l'accès à l'historique")); }
    finally { setBusy(''); }
  }

  return (
    <section>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom ou e-mail" style={founderInput} />
        <button onClick={load} style={founderButton}>Rechercher</button>
      </div>
      {error && <div style={{ ...founderNotice, color: T.red, marginBottom: 10 }}>{error}</div>}
      <h2 style={{ fontSize: 15 }}>Utilisateurs</h2>
      <div className="rsp-cols-2-lg" style={{ display: 'grid', gap: 9 }}>
        {data.profiles.map((row) => (
          <article key={row.id} style={founderCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <strong>{row.full_name || 'Compte sans nom'}</strong>
                <div style={{ color: T.mu, fontSize: 10 }}>{row.email} · {row.role} · KYC {row.kyc_status}</div>
                <div style={{ color: row.account_status === 'active' ? T.green : T.red, fontSize: 10, marginTop: 4 }}>{row.account_status}</div>
              </div>
              <div style={{ display: 'flex', gap: 7 }}>
                <button disabled={busy === row.id} onClick={() => openHistory(row.id)} style={founderButton}>Historique ({row.history_count})</button>
                <button disabled={busy === row.id} onClick={() => toggle(row.id, row.account_status)} style={{ ...founderButton, color: row.account_status === 'active' ? T.red : T.green }}>
                  {row.account_status === 'active' ? 'Suspendre' : 'Réactiver'}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <h2 style={{ fontSize: 15, marginTop: 20 }}>Structures</h2>
      <div className="rsp-cols-2-lg" style={{ display: 'grid', gap: 9 }}>
        {data.structures.map((row) => (
          <article key={row.id} style={founderCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div><strong>{row.name}</strong><div style={{ color: T.mu, fontSize: 10 }}>{row.email} · {row.verification_status} · {row.history_count} mission(s)</div></div>
              <button disabled={busy === row.owner_id} onClick={() => toggle(row.owner_id, row.account_status)} style={{ ...founderButton, color: row.account_status === 'active' ? T.red : T.green }}>
                {row.account_status === 'active' ? 'Suspendre le compte' : 'Réactiver le compte'}
              </button>
            </div>
          </article>
        ))}
      </div>

      {history && (
        <div style={{ ...founderCard, marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>Historique du compte</strong><button onClick={() => setHistory(null)} style={founderButton}>Fermer</button></div>
          {[...history.data.worker_missions, ...history.data.structure_missions].map((entry, index) => (
            <div key={`${history.id}-${index}`} style={{ borderTop: `1px solid ${T.cb}`, padding: '8px 0', fontSize: 11, color: T.sub }}>
              {String(entry.title ?? entry.action ?? 'Événement')} · {founderDate(String(entry.created_at ?? entry.scheduled_date ?? ''))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
