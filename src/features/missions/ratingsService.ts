import { supabase } from '@/lib/supabase';
import type { RatingDirection } from '@/types/database.types';

export interface StructureRating {
  average: number;
  count: number;
}

export interface StructureReview {
  score: number;
  comment: string;
  created_at: string;
}

// Note donnee par le travailleur a la structure (affichee sur la fiche de la
// structure) ou par la structure au travailleur (affichee dans son CV vivant).
// Informative, jamais bloquante : inscrit aux CGU.
export async function rate(input: {
  applicationId: string;
  structureId: string;
  workerId: string;
  score: number;
  direction: RatingDirection;
  comment?: string;
}): Promise<void> {
  const { error } = await supabase.from('ratings').insert({
    application_id: input.applicationId,
    structure_id: input.structureId,
    worker_id: input.workerId,
    score: input.score,
    direction: input.direction,
    comment: input.comment?.trim() || null,
  });
  if (error) throw error;
}

export async function fetchStructureRatings(structureIds: string[]): Promise<Map<string, StructureRating>> {
  if (structureIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc('public_structure_rating_summary', { p_structure_ids: structureIds });
  if (error) throw error;
  return new Map(
    (data ?? []).map((row) => [row.structure_id, { average: Number(row.average), count: Number(row.review_count) }]),
  );
}

export async function fetchStructureReviews(structureId: string): Promise<StructureReview[]> {
  const { data, error } = await supabase
    .from('ratings')
    .select('score, comment, created_at')
    .eq('structure_id', structureId)
    .eq('direction', 'worker_to_structure')
    .not('comment', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3);
  if (error) throw error;
  return (data ?? []).flatMap((review) => review.comment ? [{ ...review, comment: review.comment }] : []);
}

// Notes RECUES par un travailleur (donnees par les structures) : c'est ce qui
// apparait dans son historique / CV vivant.
export async function fetchWorkerReceivedRatings(workerId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('ratings')
    .select('application_id, score')
    .eq('worker_id', workerId)
    .eq('direction', 'structure_to_worker');
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.application_id, r.score]));
}

// Directions deja notees par l'utilisateur courant sur un lot de candidatures
// (pour masquer le bouton "Noter" une fois la note posee).
export async function fetchRatedApplicationIds(applicationIds: string[], direction: RatingDirection): Promise<Set<string>> {
  if (applicationIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('ratings')
    .select('application_id')
    .eq('direction', direction)
    .in('application_id', applicationIds);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.application_id));
}

export interface WorkerReputation {
  average: number | null;
  count: number;
}

export async function fetchWorkerReputation(workerId: string): Promise<WorkerReputation> {
  const { data, error } = await supabase.rpc('worker_public_rating_summary', { p_worker_id: workerId });
  if (error) throw error;
  const summary = data as { average: number | null; count: number } | null;
  return { average: summary?.average == null ? null : Number(summary.average), count: Number(summary?.count ?? 0) };
}
