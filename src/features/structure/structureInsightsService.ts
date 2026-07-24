import { supabase } from '@/lib/supabase';

export interface StructureMissionHistoryRow {
  mission_id: string;
  title: string;
  scheduled_date: string;
  address: string | null;
  completed_workers: number;
  worker_paid_cents: number;
  commission_cents: number;
  total_expense_cents: number;
  paid_at: string | null;
  archived_at: string | null;
}

export interface WeeklyStructureReview {
  score: number;
  comment: string | null;
  published_week: string;
}

export async function fetchStructureMissionHistory(
  structureId: string,
  includeArchived = false,
): Promise<StructureMissionHistoryRow[]> {
  const { data, error } = await supabase.rpc('structure_mission_history', {
    p_structure_id: structureId,
    p_include_archived: includeArchived,
  });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    completed_workers: Number(row.completed_workers),
    worker_paid_cents: Number(row.worker_paid_cents),
    commission_cents: Number(row.commission_cents),
    total_expense_cents: Number(row.total_expense_cents),
  }));
}

export async function archiveMission(missionId: string): Promise<void> {
  const { error } = await supabase.rpc('archive_mission', { p_mission_id: missionId });
  if (error) throw error;
}

export async function unarchiveMission(missionId: string): Promise<void> {
  const { error } = await supabase.rpc('unarchive_mission', { p_mission_id: missionId });
  if (error) throw error;
}

export async function fetchWeeklyStructureReviews(structureId: string): Promise<WeeklyStructureReview[]> {
  const { data, error } = await supabase.rpc('structure_weekly_reviews', { p_structure_id: structureId });
  if (error) throw error;
  return (data ?? []) as WeeklyStructureReview[];
}
