import { useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { formatEuros } from '@/lib/format';
import { fetchStructureStats, type StructureStats } from '@/features/stats/statsService';
import { fetchStructureReviews, type StructureReview } from '@/features/missions/ratingsService';
import { describeError } from '@/lib/errors';

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
    // Badge masqué tant que la structure n'a aucune mission réellement publiée
    // (les missions annulées ne comptent pas — cf. structure_stats).
    ...(stats.missions_total > 0 ? ([[String(stats.missions_total), 'missions publiées']] as [string, string][]) : []),
    [acceptanceRate, 'acceptées'],
    [rating, `${stats.ratings_count} avis`],
  ];

  return (
    <div aria-label="Résumé réel de la structure" style={{ display: 'grid', gridTemplateColumns: `repeat(${summary.length}, minmax(0, 1fr))`, gap: 7 }}>
      {summary.map(([value, label]) => (
        <div key={label} style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 11, padding: '12px 7px', textAlign: 'center' }}>
          <div style={{ fontSize: value.startsWith('★') ? 15 : 19, fontWeight: 900, color: value.startsWith('★') ? T.amber : T.text }}>{value}</div>
          <div style={{ fontSize: 8.5, color: T.mu, marginTop: 4, lineHeight: 1.2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

function StarRow({ score }: { score: number | null }) {
  const rounded = score == null ? 0 : Math.round(score);
  return (
    <span aria-hidden="true" style={{ fontSize: 22, letterSpacing: 2, color: '#f59e0b', lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (n <= rounded ? '★' : '☆')).join('')}
    </span>
  );
}

// Bloc « Performances » de l'accueil Structure : les étoiles sont l'élément
// principal, la note numérique juste dessous, le nombre d'avis toujours
// visible. Reste compact — jamais plus imposant que les missions.
export function StructurePerformances({
  structureId,
  favoris,
  avisADonner,
}: {
  structureId: string;
  favoris: number;
  avisADonner: number;
}) {
  const { stats, error } = useStructureStats(structureId);
  const [showReviews, setShowReviews] = useState(false);
  const [reviews, setReviews] = useState<StructureReview[] | null>(null);
  const [reviewsError, setReviewsError] = useState<string | null>(null);

  if (error) return <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 12 }}>Performances indisponibles.</div>;
  if (!stats) return <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 12 }}>Chargement…</div>;

  const hasReviews = stats.ratings_count > 0;
  const note = stats.avg_rating == null ? '—' : stats.avg_rating.toFixed(1).replace('.', ',');
  const tiles: [string, string][] = [
    ['Missions réalisées', String(stats.missions_completed)],
    ['Dépenses', euros(stats.total_paid_cents)],
    ['Travailleurs favoris', String(favoris)],
    ['Avis à donner', String(avisADonner)],
  ];

  function openReviews() {
    setShowReviews(true);
    setReviewsError(null);
    if (reviews === null) {
      fetchStructureReviews(structureId)
        .then(setReviews)
        .catch((e) => setReviewsError(describeError(e, 'le chargement des avis')));
    }
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: '15px 14px' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Performances</div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, marginBottom: 14 }}>
        {hasReviews ? (
          <>
            <StarRow score={stats.avg_rating} />
            <div style={{ fontSize: 26, fontWeight: 900, color: T.text, lineHeight: 1.1 }}>{note}</div>
            <div style={{ fontSize: 10.5, color: T.mu }}>{stats.ratings_count} avis</div>
            <button
              type="button"
              onClick={openReviews}
              style={{ marginTop: 4, background: 'none', border: 'none', color: T.sub, fontSize: 10.5, fontWeight: 800, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
            >
              Lire les avis
            </button>
          </>
        ) : (
          <div style={{ fontSize: 12, fontWeight: 700, color: T.mu }}>Pas encore évaluée – 0 avis</div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        {tiles.map(([l, v]) => (
          <div key={l} style={{ background: T.row, borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: T.text }}>{v}</div>
            <div style={{ fontSize: 8.5, color: T.mu, marginTop: 3 }}>{l}</div>
          </div>
        ))}
      </div>

      {showReviews && (
        <div
          className="urosi-modal-layer urosi-bottom-sheet-layer"
          role="dialog"
          aria-modal="true"
          aria-label="Avis reçus par la structure"
          style={{ background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setShowReviews(false)}
        >
          <div
            className="urosi-bottom-sheet"
            style={{ width: '100%', maxWidth: 420, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 26px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 900, color: T.text }}>Avis reçus</span>
              <button onClick={() => setShowReviews(false)} style={{ background: T.row, border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', color: T.sub, fontSize: 14 }}>×</button>
            </div>
            <div style={{ fontSize: 10, color: T.mu, marginBottom: 12, lineHeight: 1.5 }}>
              Anonymisés, publiés par lots d'au moins 3 avis — aucun avis ne permet d'identifier son auteur.
            </div>
            {reviewsError && <div style={{ fontSize: 11, color: T.red }}>{reviewsError}</div>}
            {!reviewsError && reviews === null && <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 16 }}>Chargement…</div>}
            {!reviewsError && reviews !== null && reviews.length === 0 && (
              <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 16 }}>
                Aucun commentaire publié pour le moment — les commentaires ne sont révélés que par lots d'au moins 3 avis.
              </div>
            )}
            {reviews?.map((r) => (
              <div key={`${r.created_at}-${r.comment}`} style={{ borderTop: `1px solid ${T.cb}`, padding: '11px 0' }}>
                <div style={{ color: T.amber, fontSize: 11, fontWeight: 800 }}>⭐ {r.score}/5</div>
                <div style={{ color: T.sub, fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}>{r.comment}</div>
              </div>
            ))}
          </div>
        </div>
      )}
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
