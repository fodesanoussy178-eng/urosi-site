import { useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { Stars } from '@/components/ui/Stars';
import { formatEuros } from '@/lib/format';
import { fetchStructureStats, type StructureStats } from '@/features/stats/statsService';

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

// Statistiques de la structure : activite, taux de remplissage, flux payes.
export function StatsPanel({ structureId }: { structureId: string }) {
  const [stats, setStats] = useState<StructureStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetchStructureStats(structureId)
      .then((s) => active && setStats(s))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [structureId]);

  if (error) {
    return <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 16 }}>Statistiques indisponibles.</div>;
  }
  if (!stats) {
    return <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 16 }}>Chargement…</div>;
  }

  const fillRate = stats.missions_total > 0 ? Math.round((stats.missions_completed / stats.missions_total) * 100) : null;

  const tiles: [string, string][] = [
    ['Missions publiées', String(stats.missions_total)],
    ['Missions actives', String(stats.missions_open)],
    ['Candidatures reçues', String(stats.applications_total)],
    ['En attente', String(stats.applications_pending)],
    ['Missions réalisées', String(stats.missions_completed)],
    ['Travailleurs différents', String(stats.unique_workers)],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        {tiles.map(([l, v]) => (
          <div key={l} style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 11, padding: '13px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: T.text }}>{v}</div>
            <div style={{ fontSize: 9, color: T.mu, marginTop: 3 }}>{l}</div>
          </div>
        ))}
      </div>

      <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '13px 15px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Flux financiers</div>
        {(
          [
            ['Rémunérations versées', euros(stats.total_paid_cents), T.text],
            ['dont bonus (règles de rémunération)', euros(stats.total_bonus_cents), T.green],
            ['Commissions UROSI', euros(stats.total_commission_cents), T.sub],
          ] as [string, string, string][]
        ).map(([l, v, c]) => (
          <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '4px 0' }}>
            <span style={{ color: T.sub }}>{l}</span>
            <span style={{ color: c, fontWeight: 800 }}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '13px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Réputation</div>
          {stats.avg_rating ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Stars n={stats.avg_rating} size={13} />
              <span style={{ fontSize: 14, fontWeight: 900, color: T.text }}>{stats.avg_rating.toFixed(1).replace('.', ',')}</span>
              <span style={{ fontSize: 10, color: T.mu }}>({stats.ratings_count} avis)</span>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: T.mu }}>Pas encore d'avis.</span>
          )}
        </div>
        {fillRate !== null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: T.cyan }}>{fillRate} %</div>
            <div style={{ fontSize: 8.5, color: T.mu }}>taux de réalisation</div>
          </div>
        )}
      </div>
    </div>
  );
}
