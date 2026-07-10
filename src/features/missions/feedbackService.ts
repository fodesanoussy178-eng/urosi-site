import { supabase } from '@/lib/supabase';
import type { ReportMotif } from '@/types/database.types';

export const REPORT_MOTIFS: Record<ReportMotif, string> = {
  absent: 'Structure absente / pas au rendez-vous',
  conditions: "Conditions différentes de l'annonce",
  securite: 'Sécurité / situation dangereuse',
  autre: 'Autre',
};

export async function notifyDelay(applicationId: string, minutes: number): Promise<void> {
  const { error } = await supabase.from('delay_notices').insert({ application_id: applicationId, minutes });
  if (error) throw error;
}

export async function submitReport(input: {
  applicationId: string;
  workerId: string;
  motif: ReportMotif;
  note: string;
}): Promise<void> {
  const { error } = await supabase.from('reports').insert({
    application_id: input.applicationId,
    worker_id: input.workerId,
    motif: input.motif,
    note: input.note || null,
  });
  if (error) throw error;
}

export async function fetchDelaysForApplications(applicationIds: string[]): Promise<Map<string, number>> {
  if (applicationIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('delay_notices')
    .select('application_id, minutes, created_at')
    .in('application_id', applicationIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    if (!map.has(row.application_id)) map.set(row.application_id, row.minutes);
  }
  return map;
}
