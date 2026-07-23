import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Mission, MissionInsert, Structure } from './types';

const MISSION_COLUMNS =
  'id, structure_id, title, detail, city, address, location, lat, lng, distance_km, scheduled_date, start_time, end_time, starts_at, ends_at, duration_minutes, duration_minutes_per_person, mission_days, sector, difficulty, is_urgent, worker_rate_cents, base_rate_cents, pricing_breakdown, is_solidaire, places, positions, slots, hourly_rate, worker_amount, price_total, worker_subtotal, service_fee, structure_total, total_worker_hours, time_slot, day_of_week, mission_category, dress_code, equipment, instructions, status, created_at';

export interface MissionWithStructure extends Mission {
  structure: Pick<Structure, 'name' | 'siret' | 'is_ess' | 'about' | 'verification_status'> | null;
}

export async function fetchOpenMissions(): Promise<MissionWithStructure[]> {
  const { data, error } = await supabase
    .from('missions')
    .select(`${MISSION_COLUMNS}, structure:structures(name, siret, is_ess, about, verification_status)`)
    .eq('status', 'open')
    .order('scheduled_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as MissionWithStructure[];
}

// Flux en direct : la table missions est publiee sur supabase_realtime.
// Toute publication / cloture / modification declenche onChange — le flux
// se met a jour sans recharger la page.
export function subscribeToMissionFeed(onChange: () => void): RealtimeChannel {
  return supabase
    .channel('missions-feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'missions' }, () => onChange())
    .subscribe();
}

export function unsubscribeMissionFeed(channel: RealtimeChannel): void {
  supabase.removeChannel(channel);
}

export async function fetchMissionsForStructure(structureId: string): Promise<Mission[]> {
  const { data, error } = await supabase
    .from('missions')
    .select(MISSION_COLUMNS)
    .eq('structure_id', structureId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createMission(input: MissionInsert): Promise<Mission> {
  const { data, error } = await supabase.from('missions').insert(input).select(MISSION_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function closeMission(missionId: string): Promise<void> {
  const { error } = await supabase.from('missions').update({ status: 'closed' }).eq('id', missionId);
  if (error) throw error;
}

export interface MissionNonSensitivePatch {
  title?: string;
  detail?: string | null;
  dress_code?: string | null;
  equipment?: string | null;
  instructions?: string | null;
}

// Modification volontairement limitee aux champs sans impact financier ou
// d'engagement (prix, horaires, places restent figes une fois publies) :
// evite qu'une modification apres candidature change les conditions sur
// lesquelles un travailleur s'est engage.
export async function updateMission(missionId: string, patch: MissionNonSensitivePatch): Promise<void> {
  const { error } = await supabase.from('missions').update(patch).eq('id', missionId);
  if (error) throw error;
}

// Annule la mission et, en cascade, toute candidature encore active dessus
// (en attente, acceptee ou en cours) : le travailleur est notifie via le
// trigger de statut deja en place, sans sanction automatique de son cote.
export async function cancelMission(missionId: string, activeApplicationIds: string[]): Promise<void> {
  const { error: missionError } = await supabase.from('missions').update({ status: 'cancelled' }).eq('id', missionId);
  if (missionError) throw missionError;
  for (const applicationId of activeApplicationIds) {
    const { error } = await supabase.from('applications').update({ status: 'cancelled' }).eq('id', applicationId);
    if (error) throw error;
  }
}
