import { supabase } from '@/lib/supabase';
import type { Database, ApplicationStatus } from '@/types/database.types';
import type { Mission } from './types';

export type Application = Database['public']['Tables']['applications']['Row'];

export interface ApplicationWithMission extends Application {
  mission: Pick<Mission, 'id' | 'title' | 'city' | 'scheduled_date' | 'status' | 'structure_id'> | null;
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
    .select('*, mission:missions(id, title, city, scheduled_date, status, structure_id)')
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

export async function completeApplication(applicationId: string): Promise<void> {
  const { error } = await supabase.from('applications').update({ status: 'completed' }).eq('id', applicationId);
  if (error) throw error;
}
