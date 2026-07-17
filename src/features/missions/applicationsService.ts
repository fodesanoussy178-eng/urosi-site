import { supabase } from '@/lib/supabase';
import type { Database, ApplicationStatus } from '@/types/database.types';
import type { Mission } from './types';

export type Application = Database['public']['Tables']['applications']['Row'];

export interface ApplicationWithMission extends Application {
  mission: Pick<Mission, 'id' | 'title' | 'city' | 'scheduled_date' | 'start_time' | 'duration_minutes' | 'slots' | 'status' | 'structure_id' | 'sector' | 'mission_category'> | null;
}

export interface ApplicationWithApplicant extends Application {
  profile: { full_name: string } | null;
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
    .select('*, profile:profiles(full_name)')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ApplicationWithApplicant[];
}

// Variante groupee : une seule requete pour toutes les missions d'une
// structure (le tableau de bord chargeait auparavant mission par mission).
export async function fetchApplicationsForMissions(missionIds: string[]): Promise<Map<string, ApplicationWithApplicant[]>> {
  const map = new Map<string, ApplicationWithApplicant[]>();
  if (missionIds.length === 0) return map;
  const { data, error } = await supabase
    .from('applications')
    .select('*, profile:profiles(full_name)')
    .in('mission_id', missionIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  for (const id of missionIds) map.set(id, []);
  for (const row of (data ?? []) as unknown as ApplicationWithApplicant[]) {
    const list = map.get(row.mission_id);
    if (list) list.push(row);
    else map.set(row.mission_id, [row]);
  }
  return map;
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
  profile: { full_name: string } | null;
}

// Lue par la page de pointage : la RLS ne renvoie la ligne que si la
// personne connectee est la structure proprietaire de la mission (ou le
// travailleur lui-meme), et le jeton du QR doit correspondre.
export async function fetchCheckinTarget(applicationId: string, token: string): Promise<CheckinTarget | null> {
  const { data, error } = await supabase
    .from('applications')
    .select('id, worker_id, status, checked_in_at, mission:missions(id, title, city, scheduled_date), profile:profiles(full_name)')
    .eq('id', applicationId)
    .eq('checkin_token', token)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as CheckinTarget | null;
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
