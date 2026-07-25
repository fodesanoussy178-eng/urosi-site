import { useCallback, useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import {
  founderAdminApi,
  type FounderRating,
  type FounderRatingStatusFilter,
  type FounderRatingSubjectStats,
  type RatingDirection,
  type RatingModerationAction,
} from '../founderAdminService';
import { founderButton, founderCard, founderDate, founderInput, founderNotice } from '../founderUi';
import { describeError } from '@/lib/errors';

const statusOptions = [
  ['', 'Toutes les notes'],
  ['visible', 'Publiques'],
  ['pending', 'En attente de publication'],
  ['hidden', 'Masquées'],
  ['cancelled', 'Annulées'],
  ['flagged', 'Signalées'],
] as const;

const directionOptions = [
  ['', 'Les deux sens'],
  ['worker_to_structure', 'Travailleur → Structure'],
  ['structure_to_worker', 'Structure → Travailleur'],
] as const;

// Chaque action a son inverse : le Fondateur peut toujours revenir en
// arriere (jamais d'action a sens unique), mais chaque changement — dans un
// sens ou l'autre — exige un motif et est journalise (jamais de modification
// silencieuse).
function actionsFor(row: FounderRating): Array<[RatingModerationAction, string]> {
  return [
    [row.is_hidden ? 'unhide' : 'hide', row.is_hidden ? 'Lever le masquage' : 'Masquer'],
    [row.is_cancelled ? 'uncancel' : 'cancel', row.is_cancelled ? "Lever l'annulation" : 'Annuler'],
    [row.is_flagged ? 'unflag' : 'flag', row.is_flagged ? 'Retirer le signalement' : 'Signaler'],
  ];
}

function publicStatusLabel(row: FounderRating): string {
  if (row.is_cancelled) return 'Annulée';
  if (row.is_hidden) return 'Masquée';
  if (row.is_publicly_visible) return 'Publique';
  return 'En attente';
}

function publicStatusColor(row: FounderRating): string {
  if (row.is_cancelled || row.is_hidden) return T.red;
  if (row.is_publicly_visible) return T.green;
  return T.cyan;
}

export function FounderRatingsPanel() {
  const [direction, setDirection] = useState<RatingDirection | ''>('');
  const [status, setStatus] = useState<FounderRatingStatusFilter | ''>('');
  const [rows, setRows] = useState<FounderRating[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [stats, setStats] = useState<Record<string, FounderRatingSubjectStats | 'loading' | 'error'>>({});

  const load = useCallback(async () => {
    try {
      setRows(await founderAdminApi.ratings(direction || undefined, status || undefined));
      setError('');
    } catch (cause) {
      setError(describeError(cause, 'le chargement des évaluations'));
    }
  }, [direction, status]);
  useEffect(() => { void load(); }, [load]);

  async function act(row: FounderRating, action: RatingModerationAction) {
    const reason = window.prompt('Motif obligatoire pour cette action')?.trim();
    if (!reason) return;
    setBusy(row.id);
    try {
      await founderAdminApi.moderateRating(row.id, action, reason);
      await load();
    } catch (cause) {
      setError(describeError(cause, 'cette action de modération'));
    } finally {
      setBusy('');
    }
  }

  async function toggleSubjectStats(row: FounderRating) {
    const subjectId = row.direction === 'worker_to_structure' ? row.structure_id : row.worker_id;
    const key = `${row.direction}:${subjectId}`;
    if (stats[key]) {
      setStats((prev) => { const next = { ...prev }; delete next[key]; return next; });
      return;
    }
    setStats((prev) => ({ ...prev, [key]: 'loading' }));
    try {
      const result = await founderAdminApi.ratingSubjectStats(row.direction, subjectId);
      setStats((prev) => ({ ...prev, [key]: result }));
    } catch {
      setStats((prev) => ({ ...prev, [key]: 'error' }));
    }
  }

  return (
    <section>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={direction} onChange={(event) => setDirection(event.target.value as RatingDirection | '')} style={{ ...founderInput, maxWidth: 230 }}>
          {directionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value as FounderRatingStatusFilter | '')} style={{ ...founderInput, maxWidth: 230 }}>
          {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {error && <div style={{ ...founderNotice, color: T.red }}>{error}</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.length === 0 && !error && <div style={founderNotice}>Aucune évaluation pour ces filtres.</div>}
        {rows.map((row) => {
          const subjectId = row.direction === 'worker_to_structure' ? row.structure_id : row.worker_id;
          const statKey = `${row.direction}:${subjectId}`;
          const stat = stats[statKey];
          return (
            <article key={row.id} style={founderCard} data-testid="rating-row">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <strong>
                  {'★'.repeat(row.score)}{'☆'.repeat(5 - row.score)} · {row.direction === 'worker_to_structure' ? row.structure_name : row.worker_name}
                </strong>
                <span style={{ color: publicStatusColor(row), fontSize: 10, fontWeight: 900 }}>{publicStatusLabel(row)}</span>
              </div>
              <div style={{ color: T.mu, fontSize: 10, marginTop: 4 }}>
                {row.mission_title ?? 'Mission supprimée'} · {row.author_name ?? 'Auteur inconnu'} · {founderDate(row.created_at)}
              </div>
              {row.comment && <p style={{ color: T.sub, fontSize: 12 }}>{row.comment}</p>}
              {!row.is_publicly_visible && !row.is_cancelled && (
                <div style={{ color: T.cyan, fontSize: 10 }}>Publication prévue le {founderDate(row.scheduled_publish_at)}</div>
              )}
              {(row.is_hidden || row.is_cancelled || row.is_flagged) && (
                <div style={{ color: T.mu, fontSize: 10, marginTop: 3 }}>
                  Motif : {row.moderation_reason ?? '—'} · par {row.moderated_by_name ?? '—'} le {founderDate(row.moderated_at)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {actionsFor(row).map(([key, label]) => (
                  <button key={key} disabled={busy === row.id} onClick={() => act(row, key)} style={founderButton}>{label}</button>
                ))}
                <button type="button" onClick={() => toggleSubjectStats(row)} style={founderButton}>
                  {stat ? 'Masquer la moyenne interne' : 'Moyenne interne (temps réel)'}
                </button>
              </div>
              {stat === 'loading' && <div style={{ color: T.mu, fontSize: 10, marginTop: 6 }}>Chargement…</div>}
              {stat === 'error' && <div style={{ color: T.red, fontSize: 10, marginTop: 6 }}>Impossible de charger la moyenne interne.</div>}
              {stat && stat !== 'loading' && stat !== 'error' && (
                <div style={{ borderTop: `1px solid ${T.cb}`, marginTop: 8, paddingTop: 7, color: T.mu, fontSize: 10 }}>
                  Moyenne interne : {stat.average ?? '—'}/5 sur {stat.count} note(s) · {stat.hidden_count} masquée(s) · {stat.flagged_count} signalée(s) · {stat.cancelled_count} annulée(s)
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
