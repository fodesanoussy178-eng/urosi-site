import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { T } from '@/components/ui/theme';
import { founderAdminApi, type FounderLabStatus } from '../founderAdminService';
import { founderButton, founderCard, founderDate, founderNotice } from '../founderUi';
import { createLocalLabAccount, readLocalLabAccounts, removeLocalLabAccount, type LocalLabAccount, type LocalLabAccountRole } from '../localLabAccounts';

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
  const [accountName, setAccountName] = useState('');
  const [localAccounts, setLocalAccounts] = useState<LocalLabAccount[]>(() => readLocalLabAccounts());
  const load = useCallback(async () => {
    try { setData(await founderAdminApi.labStatus()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chargement impossible.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(type: string) {
    setBusy(type);
    try { await founderAdminApi.createLabScenario(type); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Simulation impossible.'); }
    finally { setBusy(''); }
  }

  function createAccount(role: LocalLabAccountRole) {
    try {
      createLocalLabAccount(accountName, role);
      setLocalAccounts(readLocalLabAccounts());
      setAccountName('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Création impossible.');
    }
  }

  if (!data && !error) return <div style={founderNotice}>Vérification de l’environnement…</div>;
  return (
    <section>
      <div style={{ ...founderCard, marginBottom: 14, borderColor: T.cyan }}>
        <div style={{ color: T.text, fontSize: 14, fontWeight: 900 }}>Comptes de test locaux</div>
        <div style={{ color: T.mu, fontSize: 10, lineHeight: 1.5, margin: '4px 0 11px' }}>Ils vivent uniquement dans ce navigateur et n’apparaissent jamais parmi les vrais comptes Supabase.</div>
        <input
          aria-label="Nom du compte test"
          value={accountName}
          onChange={(event) => setAccountName(event.target.value)}
          placeholder="Ex. Restaurant test ou Camille Test"
          maxLength={60}
          style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${T.cb}`, borderRadius: 9, background: T.row, color: T.text, padding: '10px 11px', fontSize: 12, marginBottom: 8 }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button type="button" onClick={() => createAccount('worker')} style={founderButton}>Créer un travailleur test</button>
          <button type="button" onClick={() => createAccount('structure')} style={founderButton}>Créer une structure test</button>
        </div>
        {localAccounts.length > 0 && (
          <div style={{ display: 'grid', gap: 7, marginTop: 12 }}>
            {localAccounts.map((account) => (
              <div key={account.id} style={{ display: 'flex', alignItems: 'center', gap: 9, borderTop: `1px solid ${T.cb}`, paddingTop: 9 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: T.text, fontSize: 11.5, fontWeight: 900, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{account.name}</div>
                  <div style={{ color: T.mu, fontSize: 9 }}>{account.role === 'worker' ? 'Travailleur test' : 'Structure test'} · ce navigateur</div>
                </div>
                <Link to={`/demo?role=${account.role}&labAccount=${encodeURIComponent(account.id)}`} style={{ ...founderButton, textDecoration: 'none', padding: '7px 9px' }}>Ouvrir</Link>
                <button type="button" aria-label={`Supprimer ${account.name}`} onClick={() => setLocalAccounts(removeLocalLabAccount(account.id))} style={{ ...founderButton, color: T.red, padding: '7px 9px' }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
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
