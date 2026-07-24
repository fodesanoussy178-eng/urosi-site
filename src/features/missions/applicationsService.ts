import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Database, ApplicationStatus } from '@/types/database.types';
import type { Mission } from './types';

export type Application = Database['public']['Tables']['applications']['Row'];

export interface ApplicationWithMission extends Application {
  mission: Pick<Mission, 'id' | 'title' | 'city' | 'scheduled_date' | 'start_time' | 'duration_minutes' | 'slots' | 'status' | 'structure_id' | 'sector' | 'mission_category'> | null;
}

export interface ApplicationWithApplicant extends Application {
  // Jamais le nom légal complet : uniquement le nom d'affichage calculé côté
  // serveur (prénom, + nom de famille seulement si le travailleur l'autorise).
  profile: { display_name: string } | null;
}

// Une seule fonction serveur (jamais un select direct sur profiles) fournit
// le nom d'affichage d'un candidat : elle ne renvoie jamais le nom légal
// complet sauf si le travailleur a choisi d'afficher son nom de famille.
async function fetchDisplayNames(workerIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniqueIds = [...new Set(workerIds)];
  if (uniqueIds.length === 0) return map;
  const { data, error } = await supabase.rpc('applicants_display_names', { p_worker_ids: uniqueIds });
  if (error) throw error;
  for (const row of data ?? []) map.set(row.worker_id, row.display_name);
  return map;
}

function attachDisplayNames<T extends { worker_id: string }>(rows: T[], names: Map<string, string>): (T & { profile: { display_name: string } | null })[] {
  return rows.map((row) => ({ ...row, profile: names.has(row.worker_id) ? { display_name: names.get(row.worker_id)! } : null }));
}

export async function applyToMission(missionId: string, workerId: string): Promise<void> {
  const { error } = await supabase.from('applications').insert({ mission_id: missionId, worker_id: workerId });
  if (error) throw error;
}

export async function fetchMyApplications(workerId: string): Promise<ApplicationWithMission[]> {
  const { data, error } = await supabase
    .from('applications')
    .select('*, mission:missions(id, title, city, scheduled_date, start_time, duration_minutes, slots, status, structure_id, sector, mission_category)')
    .eq('worker_id', workerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ApplicationWithMission[];
}

export async function fetchApplicationsForMission(missionId: string): Promise<ApplicationWithApplicant[]> {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as unknown as Application[];
  const names = await fetchDisplayNames(rows.map((r) => r.worker_id));
  return attachDisplayNames(rows, names);
}

// Variante groupee : une seule requete pour toutes les missions d'une
// structure (le tableau de bord chargeait auparavant mission par mission).
export async function fetchApplicationsForMissions(missionIds: string[]): Promise<Map<string, ApplicationWithApplicant[]>> {
  const map = new Map<string, ApplicationWithApplicant[]>();
  if (missionIds.length === 0) return map;
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .in('mission_id', missionIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as unknown as Application[];
  const names = await fetchDisplayNames(rows.map((r) => r.worker_id));
  const withNames = attachDisplayNames(rows, names);
  for (const id of missionIds) map.set(id, []);
  for (const row of withNames) {
    const list = map.get(row.mission_id);
    if (list) list.push(row);
    else map.set(row.mission_id, [row]);
  }
  return map;
}

// Flux en direct côté structure : une nouvelle candidature (ou un changement
// de statut) sur l'une de ses missions rafraîchit l'onglet Candidats sans
// recharger la page. La table `applications` n'a pas de colonne structure_id
// directe, donc le filtre Realtime porte sur les missions déjà chargées.
export function subscribeToApplicationsFeed(missionIds: string[], onChange: () => void): RealtimeChannel | null {
  if (missionIds.length === 0) return null;
  const channel = supabase.channel(`applications-feed:${missionIds.join(',').slice(0, 200)}`);
  for (const missionId of missionIds) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'applications', filter: `mission_id=eq.${missionId}` },
      () => onChange(),
    );
  }
  channel.subscribe();
  return channel;
}

export function unsubscribeApplicationsFeed(channel: RealtimeChannel | null): void {
  if (channel) supabase.removeChannel(channel);
}

// Flux en direct côté travailleur : la structure confirme le pointage (scan
// du QR) depuis un autre appareil/session — la carte "mission en cours" doit
// disparaître automatiquement, sans rechargement manuel de la page.
export function subscribeToMyApplicationsFeed(workerId: string, onChange: () => void): RealtimeChannel {
  const channel = supabase.channel(`applications-feed:worker:${workerId}`);
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'applications', filter: `worker_id=eq.${workerId}` },
    () => onChange(),
  );
  channel.subscribe();
  return channel;
}

export async function updateApplicationStatus(applicationId: string, status: ApplicationStatus): Promise<void> {
  const { error } = await supabase.from('applications').update({ status }).eq('id', applicationId);
  if (error) throw error;
}

export interface CheckinTarget {
  id: string;
  worker_id: string;
  status: ApplicationStatus;
  checked_in_at: string | null;
  mission: Pick<Mission, 'id' | 'title' | 'city' | 'scheduled_date'> | null;
  profile: { display_name: string } | null;
}

// Lue par la page de pointage : la RLS ne renvoie la ligne que si la
// personne connectee est la structure proprietaire de la mission (ou le
// travailleur lui-meme), et le jeton du QR doit correspondre.
export async function fetchCheckinTarget(applicationId: string, token: string): Promise<CheckinTarget | null> {
  const { data, error } = await supabase
    .from('applications')
    .select('id, worker_id, status, checked_in_at, mission:missions(id, title, city, scheduled_date)')
    .eq('id', applicationId)
    .eq('checkin_token', token)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as Omit<CheckinTarget, 'profile'>;
  const names = await fetchDisplayNames([row.worker_id]);
  return { ...row, profile: names.has(row.worker_id) ? { display_name: names.get(row.worker_id)! } : null };
}

export async function confirmCheckin(applicationId: string, token: string): Promise<void> {
  const { error, count } = await supabase
    .from('applications')
    .update({ checked_in_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', applicationId)
    .eq('checkin_token', token);
  if (error) throw error;
  if (!count) throw new Error("Validation impossible : ce pointage n'appartient pas à ta structure.");
}
