import { supabase } from '@/lib/supabase';
import type { RatingDirection, RatingRequestStatus } from '@/types/database.types';

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

// Commentaires anonymisés sur une structure : jamais de nom/identifiant
// d'auteur, publiés uniquement par lots complets d'au moins 3 avis (chaque
// lot soumis à un délai de 5 jours côté serveur). Avec moins de 3 avis, la
// RPC ne renvoie rien — seule la moyenne (fetchStructureRatings) est
// disponible.
export async function fetchStructureReviews(structureId: string, limit = 3): Promise<StructureReview[]> {
  const { data, error } = await supabase.rpc('public_structure_reviews', {
    p_structure_id: structureId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []).flatMap((review) => (review.comment ? [{ ...review, comment: review.comment }] : []));
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

// Score de la note DEJA DONNEE par l'utilisateur courant (jamais celle recue :
// pas de contournement de l'anonymat des avis "structure_to_worker" cote
// travailleur ni de la publication par lots cote structure). Utilise pour
// afficher "la note que tu as donnee" dans le resume d'une mission terminee.
export async function fetchGivenRatingScores(applicationIds: string[], direction: RatingDirection): Promise<Map<string, number>> {
  if (applicationIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('ratings')
    .select('application_id, score')
    .eq('direction', direction)
    .in('application_id', applicationIds);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.application_id, r.score]));
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

// Demandes de note automatiquement creees a la fin de mission (une par
// direction). L'appelant recoupe application_id avec les missions/candidatures
// deja chargees pour afficher le titre de la mission et le nom de la
// contrepartie : pas de jointure lourde ici.
export interface RatingRequest {
  id: string;
  applicationId: string;
  missionId: string;
  direction: RatingDirection;
  status: RatingRequestStatus;
  createdAt: string;
  lastRemindedAt: string | null;
  reminderStage: number;
}

export async function fetchPendingRatingRequests(reviewerId: string): Promise<RatingRequest[]> {
  const { data, error } = await supabase
    .from('rating_requests')
    .select('id, application_id, mission_id, direction, status, created_at, last_reminded_at, reminder_stage')
    .eq('reviewer_id', reviewerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    applicationId: r.application_id,
    missionId: r.mission_id,
    direction: r.direction,
    status: r.status,
    createdAt: r.created_at,
    lastRemindedAt: r.last_reminded_at,
    reminderStage: r.reminder_stage,
  }));
}

// "Me le rappeler plus tard" : ne supprime jamais la demande, avance juste
// son horodatage et son etage de rappel (cadence lue cote client, voir
// shouldPromptRatingRequest).
export async function snoozeRatingRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc('snooze_rating_request', { p_id: id });
  if (error) throw error;
}

// Les avis ne sont jamais demandes immediatement a la fin de la mission :
// on laisse quelques minutes s'ecouler (le pointage de fin vient a peine
// d'etre valide). Passe ce delai, la demande est proposee a la prochaine
// occasion, puis rappelee a 24h et 72h.
export const RATING_FIRST_PROMPT_DELAY_MINUTES = 2;

// Cadence de rappel : ~5 min apres la fin, puis 24h, puis 72h apres la
// creation. Au-dela, la demande reste accessible depuis l'historique sans
// popup force (reminder_stage plafonne a 3 cote serveur).
export function shouldPromptRatingRequest(request: Pick<RatingRequest, 'createdAt' | 'lastRemindedAt' | 'reminderStage'>): boolean {
  if (request.reminderStage >= 3) return false;
  const minutesSinceCreated = (Date.now() - new Date(request.createdAt).getTime()) / 60_000;
  if (!request.lastRemindedAt) return minutesSinceCreated >= RATING_FIRST_PROMPT_DELAY_MINUTES;
  const hoursSinceLastPrompt = (Date.now() - new Date(request.lastRemindedAt).getTime()) / 3_600_000;
  const hoursSinceCreated = minutesSinceCreated / 60;
  if (request.reminderStage === 1) return hoursSinceLastPrompt >= 24;
  if (request.reminderStage === 2) return hoursSinceCreated >= 72 && hoursSinceLastPrompt >= 24;
  return false;
}
