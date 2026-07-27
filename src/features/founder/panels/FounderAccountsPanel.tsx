import { useCallback, useEffect, useRef, useState } from 'react';
import { T } from '@/components/ui/theme';
import { founderAdminApi, type AccountHistory, type FounderAccounts } from '../founderAdminService';
import { founderButton, founderCard, founderDate, founderInput, founderNotice } from '../founderUi';
import { describeError } from '@/lib/errors';
import type { WorkerPaidStatus } from '@/types/database.types';

function paidStatusLabel(status: WorkerPaidStatus): string {
  switch (status) {
    case 'paid_eligible': return 'débloquées';
    case 'conversion_pending': return 'démarche en cours';
    default: return 'solidaire uniquement';
  }
}

function paidStatusColor(status: WorkerPaidStatus, theme: typeof T): string {
  switch (status) {
    case 'paid_eligible': return theme.green;
    case 'conversion_pending': return theme.amber;
    default: return theme.mu;
  }
}

export function FounderAccountsPanel() {
  const [search, setSearch] = useState('');
  const [data, setData] = useState<FounderAccounts>({ profiles: [], structures: [] });
  const [history, setHistory] = useState<{ id: string; data: AccountHistory } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  // Micro-animation sur le badge "débloquées" quand un rechargement detecte
  // qu'un worker vient de passer a paid_eligible depuis le chargement
  // precedent (jamais sur le tout premier chargement : pas de reference).
  const prevPaidStatusRef = useRef<Map<string, WorkerPaidStatus> | null>(null);
  const [justUnlockedIds, setJustUnlockedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError('');
    try {
      const next = await founderAdminApi.accounts(search);
      const prevMap = prevPaidStatusRef.current;
      if (prevMap) {
        const newlyUnlocked = new Set<string>();
        for (const row of next.profiles) {
          if (row.role === 'worker' && row.paid_status === 'paid_eligible' && prevMap.get(row.id) && prevMap.get(row.id) !== 'paid_eligible') {
            newlyUnlocked.add(row.id);
          }
        }
        if (newlyUnlocked.size > 0) {
          setJustUnlockedIds(newlyUnlocked);
          setTimeout(() => setJustUnlockedIds(new Set()), 1600);
        }
      }
      prevPaidStatusRef.current = new Map(next.profiles.filter((r) => r.role === 'worker').map((r) => [r.id, r.paid_status]));
      setData(next);
    }
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
                {row.role === 'worker' && (
                  <div style={{ color: T.mu, fontSize: 10, marginTop: 4 }}>
                    Missions rémunérées :{' '}
                    {justUnlockedIds.has(row.id) && (
                      <style>{'@keyframes urosiFounderUnlockPop { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.3); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }'}</style>
                    )}
                    <span
                      style={{
                        display: 'inline-block',
                        color: paidStatusColor(row.paid_status, T),
                        fontWeight: 800,
                        animation: justUnlockedIds.has(row.id) ? 'urosiFounderUnlockPop .5s cubic-bezier(.34,1.56,.64,1)' : undefined,
                      }}
                    >
                      {justUnlockedIds.has(row.id) ? '✓ ' : ''}
                      {paidStatusLabel(row.paid_status)}
                    </span>
                    {row.siret && <> · SIRET {row.siret}{row.siret_verified_at ? ' (vérifié)' : ' (en attente)'}</>}
                    {row.stripe_requirements_pending && !row.stripe_payouts_enabled && <> · régression Stripe</>}
                  </div>
                )}
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
