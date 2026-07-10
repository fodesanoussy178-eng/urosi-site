import { supabase } from '@/lib/supabase';

export interface StructureStats {
  missions_total: number;
  missions_open: number;
  applications_total: number;
  applications_pending: number;
  missions_completed: number;
  unique_workers: number;
  total_paid_cents: number;
  total_commission_cents: number;
  total_bonus_cents: number;
  avg_rating: number | null;
  ratings_count: number;
}

export interface WorkerMonthlyStat {
  month: string;
  earnings_cents: number;
  missions: number;
}

export interface WorkerStats {
  completed_count: number;
  upcoming_count: number;
  pending_count: number;
  earnings_total_cents: number;
  bonus_total_cents: number;
  avg_rating: number | null;
  monthly: WorkerMonthlyStat[];
}

export interface CvExperience {
  title: string;
  sector: string;
  scheduled_date: string;
  structure_name: string;
  presence_validated: boolean;
  score: number | null;
}

export interface WorkerCv {
  full_name: string;
  city: string | null;
  bio: string | null;
  skills: string[];
  completed_count: number;
  avg_rating: number | null;
  ratings_count: number;
  experiences: CvExperience[];
}

export async function fetchStructureStats(structureId: string): Promise<StructureStats> {
  const { data, error } = await supabase.rpc('structure_stats', { p_structure_id: structureId });
  if (error) throw error;
  return data as unknown as StructureStats;
}

export async function fetchWorkerStats(): Promise<WorkerStats> {
  const { data, error } = await supabase.rpc('worker_stats', {});
  if (error) throw error;
  return data as unknown as WorkerStats;
}

export async function fetchWorkerCv(workerId: string): Promise<WorkerCv> {
  const { data, error } = await supabase.rpc('worker_cv', { p_worker_id: workerId });
  if (error) throw error;
  return data as unknown as WorkerCv;
}
