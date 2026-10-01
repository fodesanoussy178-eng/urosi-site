import { supabase } from '@/lib/supabase';
import type { ApplicationStatus, AttendanceStatus, CvStatus, Database, ExternalApplicationStatus, RatingDirection } from '@/types/database.types';
import type { ExternalMission } from '@/features/missions/solidarityMissions';

export type ExternalApplication = Database['public']['Tables']['external_applications']['Row'];

export interface ExternalApplicationWithMission extends ExternalApplication {
  mission: ExternalMission | null;
}

// Candidature interne à une mission native UROSI, avec ce qu'il faut pour le
// suivi et le parcours (structure, horaires réels, statut CV).
export interface ParticipantApplication {
  id: string;
  mission_id: string;
  status: ApplicationStatus;
  attendance_status: AttendanceStatus;
  cv_status: CvStatus | null;
  cv_status_reason: string | null;
  cv_verified_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  conversation_status: 'open' | 'closed';
  created_at: string;
  mission: {
    id: string;
    title: string;
    city: string | null;
    address: string | null;
    scheduled_date: string;
    start_time: string | null;
    end_time: string | null;
    duration_minutes: number;
    mission_category: string;
    is_solidaire: boolean;
    structure_id: string;
    structure: { name: string; trade_name: string | null; logo_url: string | null } | null;
  } | null;
}

export interface ParticipantRating {
  application_id: string;
  structure_id: string;
  score: number;
  comment: string | null;
  direction: RatingDirection;
  status: 'pending' | 'published';
  created_at: string;
}

function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '');
}

export async function fetchMyExternalApplications(userId: string): Promise<ExternalApplicationWithMission[]> {
  const { data, error } = await supabase
    .from('external_applications')
    .select('*, mission:external_missions(*)')
    .eq('user_id', userId)
    .order('clicked_at', { ascending: false });
  if (isMissingRelation(error)) return [];
  if (error) throw error;
  return (data ?? []) as unknown as ExternalApplicationWithMission[];
}

export async function fetchParticipantApplications(userId: string): Promise<ParticipantApplication[]> {
  const { data, error } = await supabase
    .from('applications')
    .select(
      'id, mission_id, status, attendance_status, cv_status, cv_status_reason, cv_verified_at, actual_start_at, actual_end_at, conversation_status, created_at, ' +
        'mission:missions(id, title, city, address, scheduled_date, start_time, end_time, duration_minutes, mission_category, is_solidaire, structure_id, structure:structures(name, trade_name, logo_url))',
    )
    .eq('worker_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ParticipantApplication[];
}

// La RLS ne renvoie que les avis donnés par la personne et les avis reçus
// déjà publiés (anti-représailles) : rien à filtrer de plus ici.
export async function fetchMyRatings(userId: string): Promise<ParticipantRating[]> {
  const { data, error } = await supabase
    .from('ratings')
    .select('application_id, structure_id, score, comment, direction, status, created_at')
    .eq('worker_id', userId)
    .eq('is_hidden', false)
    .eq('is_cancelled', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ParticipantRating[];
}

// Enregistre la candidature externe AVANT la redirection. Une seconde
// tentative sur la même mission conserve la trace existante (et son statut).
export async function recordExternalApplication(userId: string, missionId: string, source: string): Promise<void> {
  const { error } = await supabase.from('external_applications').insert({
    user_id: userId,
    external_mission_id: missionId,
    source,
    status: 'external_application_started',
  });
  if (error && error.code !== '23505') throw error;
}

// Déclarations du participant : jamais 'verified' (refusé en base).
export async function declareExternalApplication(
  applicationId: string,
  status: Exclude<ExternalApplicationStatus, 'verified'>,
  declaredMinutes?: number | null,
): Promise<void> {
  const patch: Database['public']['Tables']['external_applications']['Update'] = { status };
  if (declaredMinutes != null) patch.declared_minutes = declaredMinutes;
  const { error } = await supabase.from('external_applications').update(patch).eq('id', applicationId);
  if (error) throw error;
}

const AVATAR_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const extension = AVATAR_TYPES[file.type];
  if (!extension) throw new Error('Format refusé : utilise une photo JPG, PNG ou WebP.');
  if (file.size <= 0 || file.size > 3 * 1024 * 1024) throw new Error('La photo doit faire moins de 3 Mo.');
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const { error: updateError } = await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', userId);
  if (updateError) throw updateError;
  return data.publicUrl;
}

export async function removeAvatar(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
  if (error) throw error;
}

export async function saveInterests(userId: string, interests: string[]): Promise<void> {
  const { error } = await supabase.from('profiles').update({ interests }).eq('id', userId);
  if (error) throw error;
}
