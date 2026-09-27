import { supabase } from '@/lib/supabase';
import type { ExternalImportStatus } from '@/types/database.types';

export interface ExternalImportRun {
  id: string;
  source: string;
  trigger: 'manual' | 'cron';
  status: ExternalImportStatus;
  started_at: string;
  finished_at: string | null;
  fetched: number;
  imported: number;
  skipped: number;
  deactivated: number;
  skip_reasons: Record<string, number>;
  error_message: string | null;
}

export interface ExternalMissionsOverview {
  sources: Array<{ source: string; active: number; inactive: number; last_seen_at: string | null }>;
  last_success: ExternalImportRun | null;
  runs: ExternalImportRun[];
  applications: { total: number; last_7_days: number; by_status: Record<string, number> };
  recent_missions: Array<{
    id: string;
    source: string;
    external_id: string;
    client_id: string | null;
    publisher_name: string | null;
    title: string;
    organization_name: string | null;
    city: string | null;
    is_active: boolean;
    last_seen_at: string;
    applications: number;
  }>;
}

export async function fetchExternalMissionsOverview(): Promise<ExternalMissionsOverview> {
  const { data, error } = await supabase.rpc('founder_external_missions_overview');
  if (error) throw error;
  return data as unknown as ExternalMissionsOverview;
}

// Relance manuelle : l'Edge Function vérifie elle-même l'accès fondateur.
export async function runApiEngagementImport(): Promise<ExternalImportRun & { run_id: string }> {
  const { data, error } = await supabase.functions.invoke('import-api-engagement', { body: { trigger: 'manual' } });
  if (error) throw error;
  return data as ExternalImportRun & { run_id: string };
}

// Participations déclarées (« J'y suis allé ») en attente de la structure.
// Aucun email n'est envoyé automatiquement : le lien est transmis par l'équipe.
export interface PendingParticipation {
  id: string;
  participant: string;
  mission_title: string;
  organization_name: string | null;
  organization_url: string | null;
  mission_date: string | null;
  declared_at: string | null;
  token: string;
}

export async function fetchPendingParticipations(): Promise<PendingParticipation[]> {
  const { data, error } = await supabase.rpc('founder_pending_participations');
  if (error) throw error;
  return (data as unknown as PendingParticipation[]) ?? [];
}

export function confirmationLink(token: string): string {
  return `${window.location.origin}/confirmer/${token}`;
}
