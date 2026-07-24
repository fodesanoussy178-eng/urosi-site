import { useEffect, useMemo, useState } from 'react';
import { Stars } from '@/components/ui/Stars';
import { T } from '@/components/ui/theme';
import { formatEuros } from '@/lib/format';
import {
  archiveMission,
  fetchStructureMissionHistory,
  fetchWeeklyStructureReviews,
  unarchiveMission,
  type StructureMissionHistoryRow,
  type WeeklyStructureReview,
} from './structureInsightsService';

const DEFAULT_HISTORY_SIZE = 5;

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function downloadHistory(rows: StructureMissionHistoryRow[]) {
  const header = ['Date', 'Mission', 'Adresse', 'Travailleurs', 'Rémunérations (€)', 'Frais (€)', 'Dépense totale (€)'];
  const lines = rows.map((row) => [
    row.scheduled_date,
    row.title,
    row.address ?? '',
    row.completed_workers,
    (row.worker_paid_cents / 100).toFixed(2),
    (row.commission_cents / 100).toFixed(2),
    (row.total_expense_cents / 100).toFixed(2),
  ]);
  const csv = `\uFEFF${[header, ...lines].map((line) => line.map(csvCell).join(';')).join('\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `urosi-depenses-${new Date().toISOString().slice(0, 10)}.csv`;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function StructureHistoryPanel({ structureId }: { structureId: string }) {
  const [history, setHistory] = useState<StructureMissionHistoryRow[]>([]);
  const [reviews, setReviews] = useState<WeeklyStructureReview[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busyMission, setBusyMission] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  function loadHistory(includeArchived: boolean) {
    return fetchStructureMissionHistory(structureId, includeArchived).then(setHistory);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    Promise.all([fetchStructureMissionHistory(structureId, showArchived), fetchWeeklyStructureReviews(structureId)])
      .then(([historyRows, reviewRows]) => {
        if (!active) return;
        setHistory(historyRows);
        setReviews(reviewRows);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [structureId, showArchived]);

  async function toggleArchive(row: StructureMissionHistoryRow) {
    setBusyMission(row.mission_id);
    try {
      if (row.archived_at) await unarchiveMission(row.mission_id);
      else await archiveMission(row.mission_id);
      await loadHistory(showArchived);
    } catch {
      setError(true);
    } finally {
      setBusyMission(null);
    }
  }

  const visibleHistory = expanded ? history : history.slice(0, DEFAULT_HISTORY_SIZE);
  const reviewAverage = useMemo(
    () => reviews.length > 0 ? reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length : null,
    [reviews],
  );

  if (error) return <div style={{ color: T.mu, fontSize: 11 }}>Historique momentanément indisponible.</div>;

  return (
    <>
      <section style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={labelStyle}>Historique des missions terminées</div>
            <div style={{ color: T.mu, fontSize: 9 }}>Les 5 plus récentes sont affichées par défaut.</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={() => setShowArchived((v) => !v)} style={{ ...buttonStyle, color: showArchived ? T.text : T.cyan }}>
              {showArchived ? 'Masquer archivées' : 'Voir les archivées'}
            </button>
            <button onClick={() => downloadHistory(history)} disabled={history.length === 0} style={buttonStyle}>Télécharger</button>
          </div>
        </div>
        {loading && <div style={{ color: T.mu, fontSize: 11 }}>Chargement de l’historique…</div>}
        {!loading && history.length === 0 && <div style={{ color: T.mu, fontSize: 11 }}>Aucune mission terminée.</div>}
        {visibleHistory.map((row) => (
          <div key={row.mission_id} style={{ borderTop: `1px solid ${T.cb}`, padding: '9px 0', opacity: row.archived_at ? 0.6 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: T.text, fontSize: 11.5, fontWeight: 800 }}>
                  {row.title}{row.archived_at && <span style={{ color: T.mu, fontWeight: 700 }}> · archivée</span>}
                </div>
                <div style={{ color: T.mu, fontSize: 9.5, marginTop: 3 }}>
                  {new Date(`${row.scheduled_date}T12:00:00`).toLocaleDateString('fr-FR')} · 📍 {row.address || 'Adresse non renseignée'} · {row.completed_workers} travailleur{row.completed_workers > 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                <div style={{ color: T.text, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap' }}>{euros(row.total_expense_cents)}</div>
                <button onClick={() => toggleArchive(row)} disabled={busyMission === row.mission_id} style={{ background: 'none', border: 0, color: T.mu, fontSize: 9, fontWeight: 800, cursor: 'pointer', padding: 0 }}>
                  {busyMission === row.mission_id ? '…' : row.archived_at ? 'Désarchiver' : 'Archiver'}
                </button>
              </div>
            </div>
          </div>
        ))}
        {history.length > DEFAULT_HISTORY_SIZE && (
          <button onClick={() => setExpanded((value) => !value)} style={{ ...buttonStyle, width: '100%', marginTop: 8 }}>
            {expanded ? 'Réduire' : `Voir tout l’historique (${history.length})`}
          </button>
        )}
      </section>

      <section style={cardStyle}>
        <div style={labelStyle}>Avis anonymes</div>
        <div style={{ color: T.mu, fontSize: 9, marginBottom: 10 }}>Publication le lundi par lots de 3 avis. Les avis insuffisants sont reportés. Aucun auteur, mission ou horaire n’est communiqué.</div>
        {loading ? (
          <div style={{ color: T.mu, fontSize: 11 }}>Chargement des avis…</div>
        ) : reviewAverage == null ? (
          <div style={{ color: T.mu, fontSize: 11 }}>Aucun avis publié pour le moment.</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
            <Stars n={reviewAverage} size={13} />
            <span style={{ color: T.text, fontSize: 14, fontWeight: 900 }}>{reviewAverage.toFixed(1).replace('.', ',')}</span>
            <span style={{ color: T.mu, fontSize: 10 }}>({reviews.length} avis)</span>
          </div>
        )}
        {reviews.filter((review) => review.comment).map((review, index) => (
          <div key={`${review.published_week}-${index}`} style={{ borderTop: `1px solid ${T.cb}`, padding: '8px 0', color: T.sub, fontSize: 10.5, lineHeight: 1.45 }}>
            <span style={{ color: T.amber }}>{'★'.repeat(review.score)}</span> · « {review.comment} »
            <div style={{ color: T.mu, fontSize: 8.5, marginTop: 2 }}>Avis anonyme publié la semaine du {new Date(`${review.published_week}T12:00:00`).toLocaleDateString('fr-FR')}</div>
          </div>
        ))}
      </section>
    </>
  );
}

const cardStyle = { background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '13px 15px' } as const;
const labelStyle = { color: T.mu, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 } as const;
const buttonStyle = { background: T.row, color: T.cyan, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '7px 9px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' } as const;
