import { supabase } from '@/lib/supabase';
import type { RatingDirection } from '@/types/database.types';

export interface StructureRating {
  average: number;
  count: number;
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
}): Promise<void> {
  const { error } = await supabase.from('ratings').insert({
    application_id: input.applicationId,
    structure_id: input.structureId,
    worker_id: input.workerId,
    score: input.score,
    direction: input.direction,
  });
  if (error) throw error;
}

export async function fetchStructureRatings(structureIds: string[]): Promise<Map<string, StructureRating>> {
  if (structureIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('ratings')
    .select('structure_id, score')
    .eq('direction', 'worker_to_structure')
    .in('structure_id', structureIds);
  if (error) throw error;
  const map = new Map<string, StructureRating>();
  for (const row of data ?? []) {
    const entry = map.get(row.structure_id) ?? { average: 0, count: 0 };
    entry.average = (entry.average * entry.count + row.score) / (entry.count + 1);
    entry.count += 1;
    map.set(row.structure_id, entry);
  }
  return map;
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
  const { data, error } = await supabase
    .from('ratings')
    .select('score')
    .eq('worker_id', workerId)
    .eq('direction', 'structure_to_worker');
  if (error) throw error;
  const scores = (data ?? []).map((r) => r.score);
  if (scores.length === 0) return { average: null, count: 0 };
  return { average: scores.reduce((s, v) => s + v, 0) / scores.length, count: scores.length };
}
