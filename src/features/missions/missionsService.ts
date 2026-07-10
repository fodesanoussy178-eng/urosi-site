import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Mission, MissionInsert } from './types';

const MISSION_COLUMNS =
  'id, structure_id, title, detail, city, address, lat, lng, distance_km, scheduled_date, start_time, duration_minutes, sector, difficulty, is_urgent, worker_rate_cents, base_rate_cents, pricing_breakdown, is_solidaire, status, created_at';

export interface MissionWithStructure extends Mission {
  structure: { name: string; siret: string | null; is_ess: boolean; about: string | null } | null;
}

export async function fetchOpenMissions(): Promise<MissionWithStructure[]> {
  const { data, error } = await supabase
    .from('missions')
    .select(`${MISSION_COLUMNS}, structure:structures(name, siret, is_ess, about)`)
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
