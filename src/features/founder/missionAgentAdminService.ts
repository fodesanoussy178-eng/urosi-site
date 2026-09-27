import { supabase } from '@/lib/supabase';
import type { ExternalImportStatus } from '@/types/database.types';

export type SourceRunStatus = 'success' | 'partial' | 'not_configured' | 'blocked' | 'error' | 'skipped';

export interface AgentSourceReport {
  source: string;
  name: string;
  status: SourceRunStatus;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  reactivated: number;
  deactivated: number;
  skipped: number;
  images_found: number;
  images_rejected: number;
  message: string | null;
}

export interface AgentRun {
  id: string;
  trigger: 'manual' | 'cron';
  status: ExternalImportStatus;
  started_at: string;
  finished_at: string | null;
  fetched: number;
  imported: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  reactivated_count: number;
  skipped: number;
  deactivated: number;
  duplicates: number;
  without_image: number;
  images_found: number;
  images_rejected: number;
  sources_report: AgentSourceReport[];
  errors: Array<{ source: string; message: string }>;
  error_message: string | null;
}

export interface AgentSource {
  id: string;
  name: string;
  source_type: string;
  enabled: boolean;
  automated_access_allowed: boolean;
  mission_images_reusable: boolean;
  logos_reusable: boolean;
  reuse_basis: string | null;
  verified_at: string | null;
  active: number;
  inactive: number;
  last_checked_at: string | null;
}

export interface MissionAgentOverview {
  schedule: { jobname: string; schedule: string; active: boolean } | null;
  next_run_at: string | null;
  last_run: AgentRun | null;
  runs: AgentRun[];
  sources: AgentSource[];
  catalog: {
    active: number;
    duplicates: number;
    without_image: number;
    without_photo: number;
    native_without_photo: number;
    images_found: number;
    images_rejected: number;
    by_image_source: Record<string, number>;
  };
  rejected_images: Array<{
    id: string;
    image_url: string;
    source: string;
    source_url: string | null;
    rights_note: string | null;
    created_at: string;
    mission_title: string | null;
    mission_source: string | null;
  }>;
}

export async function fetchMissionAgentOverview(): Promise<MissionAgentOverview> {
  const { data, error } = await supabase.rpc('founder_mission_agent_overview');
  if (error) throw error;
  return data as unknown as MissionAgentOverview;
}

// « Relancer maintenant » : l'Edge Function vérifie elle-même l'accès fondateur.
export async function runMissionAgentNow(): Promise<AgentRun & { run_id: string }> {
  const { data, error } = await supabase.functions.invoke('mission-agent', { body: {} });
  if (error) throw error;
  return data as AgentRun & { run_id: string };
}

// Vérification humaine des droits d'une image trouvée par l'agent.
export async function authorizeImageRights(imageId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('founder_set_image_rights', { p_image_id: imageId, p_rights_status: 'authorized', p_note: note });
  if (error) throw error;
}
