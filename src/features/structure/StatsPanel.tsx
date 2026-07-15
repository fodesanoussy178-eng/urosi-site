import { useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { formatEuros } from '@/lib/format';
import { fetchStructureStats, type StructureStats } from '@/features/stats/statsService';

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

function useStructureStats(structureId: string) {
  const [stats, setStats] = useState<StructureStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setError(false);
    fetchStructureStats(structureId)
      .then((s) => active && setStats(s))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [structureId]);

  return { stats, error };
}

export function StructureStatsSummary({ structureId, acceptedCount, decidedCount }: { structureId: string; acceptedCount: number; decidedCount: number }) {
  const { stats, error } = useStructureStats(structureId);

  if (error) return <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 12 }}>Résumé indisponible.</div>;
  if (!stats) return <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 12 }}>Chargement des statistiques…</div>;

  const acceptanceRate = decidedCount > 0 ? `${Math.round((acceptedCount / decidedCount) * 100)} %` : '—';
  const rating = stats.avg_rating == null ? '—' : `★ ${stats.avg_rating.toFixed(1).replace('.', ',')}`;
  const summary: [string, string][] = [
    [String(stats.missions_total), 'missions publiées'],
    [acceptanceRate, 'acceptées'],
    [rating, `${stats.ratings_count} avis`],
  ];

  return (
    <div aria-label="Résumé réel de la structure" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7 }}>
      {summary.map(([value, label]) => (
        <div key={label} style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 11, padding: '12px 7px', textAlign: 'center' }}>
          <div style={{ fontSize: value.startsWith('★') ? 15 : 19, fontWeight: 900, color: value.startsWith('★') ? T.amber : T.text }}>{value}</div>
          <div style={{ fontSize: 8.5, color: T.mu, marginTop: 4, lineHeight: 1.2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// Statistiques de la structure : activite, taux de remplissage, flux payes.
export function StatsPanel({ structureId }: { structureId: string }) {
  const { stats, error } = useStructureStats(structureId);

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

      {fillRate !== null && (
        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '13px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Taux de réalisation</div>
            <div style={{ fontSize: 10, color: T.mu }}>Missions terminées sur les missions publiées.</div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: T.cyan }}>{fillRate} %</div>
        </div>
      )}
    </div>
  );
}
