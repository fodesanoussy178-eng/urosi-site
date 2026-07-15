import { useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { founderAdminApi, type FounderRevenue } from '../founderAdminService';
import { founderCard, founderEuros, founderNotice } from '../founderUi';

export function FounderRevenuePanel() {
  const [data, setData] = useState<FounderRevenue | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { founderAdminApi.revenue().then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : 'Chargement impossible.')); }, []);
  if (error) return <div style={{ ...founderNotice, color: T.red }}>{error}</div>;
  if (!data) return <div style={founderNotice}>Chargement des revenus…</div>;
  const rows = [
    ['Commissions générées', data.generated_cents],
    ['Commissions en attente', data.pending_cents],
    ['Total du mois', data.month_cents],
    ['Total depuis le lancement', data.lifetime_cents],
    ['Calculé en simulation interne', data.simulated_cents],
    ['Rapproché et confirmé', data.confirmed_cents],
  ] as const;
  return (
    <section>
      {data.simulated && <div style={{ ...founderNotice, color: T.amber, marginBottom: 12 }}>REGISTRE ANALYTIQUE · Les montants « simulation interne » sont calculés mais ne prouvent aucun encaissement bancaire réel.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        {rows.map(([label, value]) => <article key={label} style={founderCard}><div style={{ color: T.mu, fontSize: 10 }}>{label}</div><div style={{ fontSize: 25, fontWeight: 950, marginTop: 8 }}>{founderEuros(value)}</div></article>)}
      </div>
    </section>
  );
}
