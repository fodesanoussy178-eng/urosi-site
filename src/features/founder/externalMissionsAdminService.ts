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

// Participations déclarées (« J'y suis allé ») en attente de la structure,
// avec la méthode de vérification RÉELLEMENT disponible pour chacune :
//   urosi_native_confirmation  structure inscrite (même SIREN) : elle confirme
//                              dans son espace, rien à faire ici ;
//   structure_confirmation     lien unique à émettre vers un canal officiel
//                              vérifié par l'équipe (aucun email supposé,
//                              aucun envoi automatique) ;
//   partner_status             statut de la plateforme : non disponible à ce jour.
export type VerificationMethod = 'partner_status' | 'structure_confirmation' | 'urosi_native_confirmation';

export interface PendingParticipation {
  id: string;
  participant: string;
  mission_title: string;
  organization_name: string | null;
  organization_url: string | null;
  mission_date: string | null;
  declared_at: string | null;
  method: VerificationMethod;
  token: string | null;
  channel_note: string | null;
  expires_at: string | null;
}

export async function fetchPendingParticipations(): Promise<PendingParticipation[]> {
  const { data, error } = await supabase.rpc('founder_pending_participations');
  if (error) throw error;
  return (data as unknown as PendingParticipation[]) ?? [];
}

// Émet le lien de confirmation, en notant le canal officiel vérifié par
// lequel il sera transmis (ex. « email publié sur le site officiel »).
export async function issueConfirmationRequest(applicationId: string, channelNote: string): Promise<string> {
  const { data, error } = await supabase.rpc('founder_issue_confirmation_request', { p_application_id: applicationId, p_channel_note: channelNote });
  if (error) throw error;
  return data as string;
}

export function confirmationLink(token: string): string {
  return `${window.location.origin}/confirmer/${token}`;
}
