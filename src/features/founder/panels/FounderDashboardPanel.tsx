import { useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { founderAdminApi, type FounderDashboard } from '../founderAdminService';
import { founderCard, founderNotice } from '../founderUi';
import { describeError } from '@/lib/errors';

export function FounderDashboardPanel() {
  const [data, setData] = useState<FounderDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    founderAdminApi.dashboard().then(setData).catch((reason) => setError(describeError(reason, 'le chargement du tableau de bord')));
  }, []);

  if (error) return <div style={{ ...founderNotice, color: T.red }}>{error}</div>;
  if (!data) return <div style={founderNotice}>Chargement du tableau de bord…</div>;

  const metrics = [
    ['Utilisateurs inscrits', data.users],
    ['Structures inscrites', data.structures],
    ['Missions publiées', data.missions_published],
    ['Missions en cours', data.missions_in_progress],
    ['Missions terminées', data.missions_completed],
    ['Candidatures', data.applications],
    ['Signalements en attente', data.reports_pending],
    ['KYC en attente', data.kyc_pending],
  ] as const;

  return (
    <section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {metrics.map(([label, value]) => (
          <article key={label} style={founderCard}>
            <div style={{ color: T.mu, fontSize: 10, fontWeight: 800 }}>{label}</div>
            <div style={{ fontSize: 29, fontWeight: 950, marginTop: 7 }}>{value}</div>
          </article>
        ))}
      </div>
      <div style={{ ...founderNotice, marginTop: 12, color: data.aal === 'aal2' ? T.green : T.amber }}>
        Sécurité : session {data.aal.toUpperCase()} · 2FA {data.mfa_required ? 'obligatoire' : 'prête à être activée côté Supabase'}.
      </div>
    </section>
  );
}
