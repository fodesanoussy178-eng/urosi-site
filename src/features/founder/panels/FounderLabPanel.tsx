import { useCallback, useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { founderAdminApi, type FounderLabStatus } from '../founderAdminService';
import { founderButton, founderCard, founderDate, founderNotice } from '../founderUi';
import { describeError } from '@/lib/errors';

const scenarios = [
  ['user', 'Faux utilisateur'],
  ['structure', 'Fausse structure'],
  ['mission', 'Fausse mission'],
  ['pricing', 'Règle / calcul de prix'],
  ['payment', 'Paiement simulé'],
  ['kyc', 'KYC simulé'],
] as const;

export function FounderLabPanel() {
  const [data, setData] = useState<FounderLabStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try { setData(await founderAdminApi.labStatus()); setError(''); }
    catch (cause) { setError(describeError(cause, "la vérification de l'environnement")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(type: string) {
    setBusy(type);
    try { await founderAdminApi.createLabScenario(type); await load(); }
    catch (cause) { setError(describeError(cause, 'cette simulation')); }
    finally { setBusy(''); }
  }

  if (!data && !error) return <div style={founderNotice}>Vérification de l’environnement…</div>;
  return (
    <section>
      <div style={{ ...founderNotice, borderColor: data?.enabled ? T.amber : T.red, color: data?.enabled ? T.amber : T.red, marginBottom: 12 }}>
        MODE LABORATOIRE · Base {data?.environment ?? 'inconnue'} · {data?.enabled ? 'activé' : 'bloqué'}. Les scénarios restent dans une table séparée et ne créent aucun utilisateur ou paiement réel.
      </div>
      {error && <div style={{ ...founderNotice, color: T.red, marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
        {scenarios.map(([type, label]) => <button key={type} disabled={!data?.enabled || busy === type} onClick={() => create(type)} style={founderButton}>{label}</button>)}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {(data?.scenarios ?? []).map((row) => <article key={row.id} style={founderCard}><strong style={{ fontSize: 12 }}>{row.label}</strong><div style={{ color: T.mu, fontSize: 10 }}>{row.entity_type} · {founderDate(row.created_at)}</div></article>)}
      </div>
    </section>
  );
}
