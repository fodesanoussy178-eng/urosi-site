// Modèle unifié des missions affichées au participant.
//
//   external_solidarity_mission : importée d'une plateforme partenaire
//                                 (candidature sur le site d'origine) ;
//   urosi_solidarity_mission    : publiée directement sur UROSI par une
//                                 structure vérifiée (candidature interne) ;
//   paid_mission                : mission rémunérée — inactive et invisible
//                                 tant que la couche rémunérée est en sommeil.
//
// Ajouter une famille = ajouter un membre à MissionKind et un adaptateur ;
// l'interface ne consomme que FeedMission.
import { supabase } from '@/lib/supabase';
import { distanceKm, geocodeMelCity, type LatLng } from '@/lib/geo';
import { features } from '@/lib/features';
import type { Database } from '@/types/database.types';
import { toCategory, type SolidarityCategory } from './categories';
import { fetchOpenMissions, type MissionWithStructure } from './missionsService';

export type MissionKind = 'external_solidarity_mission' | 'urosi_solidarity_mission' | 'paid_mission';
export type ExternalMission = Database['public']['Tables']['external_missions']['Row'];

export interface FeedMission {
  key: string;
  id: string;
  kind: MissionKind;
  source: string;
  title: string;
  description: string | null;
  organization: { id: string | null; name: string; logoUrl: string | null; verified: boolean };
  imageUrl: string | null;
  illustrationUrl: string | null;
  category: SolidarityCategory;
  city: string | null;
  address: string | null;
  coords: LatLng | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  scheduleText: string | null;
  durationMinutes: number | null;
  places: number | null;
  applicationUrl: string | null;
  isShort: boolean;
}

export const SOURCE_LABELS: Record<string, string> = {
  api_engagement: 'API Engagement',
  urosi: 'UROSI',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? 'plateforme partenaire';
}

// Nom de domaine du site où la candidature se poursuit (ex. jeveuxaider.gouv.fr).
export function partnerHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Mission courte : quatre heures ou moins.
const SHORT_MISSION_MAX_MINUTES = 240;

function parisParts(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

function coordsOf(lat: number | null, lng: number | null, city: string | null, address: string | null): LatLng | null {
  if (lat != null && lng != null) return { lat, lng };
  return geocodeMelCity(`${address ?? ''} ${city ?? ''}`);
}

export function fromExternalMission(m: ExternalMission): FeedMission {
  const start = m.starts_at ? parisParts(m.starts_at) : null;
  const end = m.ends_at ? parisParts(m.ends_at) : null;
  const sameDay = start && end && start.date === end.date;
  return {
    key: `external:${m.id}`,
    id: m.id,
    kind: 'external_solidarity_mission',
    source: m.source,
    title: m.title,
    description: m.description,
    organization: { id: null, name: m.organization_name || 'Association partenaire', logoUrl: m.organization_logo_url, verified: false },
    imageUrl: m.image_url,
    illustrationUrl: m.source_illustration_url,
    category: toCategory(m.category),
    city: m.city,
    address: m.address,
    coords: coordsOf(m.lat, m.lng, m.city, m.address),
    date: start?.date ?? null,
    startTime: m.duration_minutes && start ? start.time : null,
    endTime: m.duration_minutes && sameDay && end ? end.time : null,
    scheduleText: m.schedule_text,
    durationMinutes: m.duration_minutes,
    places: m.places,
    applicationUrl: m.application_url,
    isShort: m.duration_minutes != null && m.duration_minutes <= SHORT_MISSION_MAX_MINUTES,
  };
}

export function fromNativeMission(m: MissionWithStructure): FeedMission {
  const structure = m.structure;
  const verified = structure?.verification_status === 'verified' || structure?.verification_status === 'founder_bypass';
  return {
    key: `urosi:${m.id}`,
    id: m.id,
    kind: m.is_solidaire ? 'urosi_solidarity_mission' : 'paid_mission',
    source: 'urosi',
    title: m.title,
    description: m.detail,
    organization: {
      id: m.structure_id,
      name: structure?.trade_name || structure?.name || 'Structure',
      logoUrl: structure?.logo_url ?? null,
      verified,
    },
    imageUrl: null,
    illustrationUrl: null,
    category: toCategory(m.mission_category),
    city: m.city,
    address: m.address || m.location,
    coords: coordsOf(m.lat, m.lng, m.city, m.address),
    date: m.scheduled_date,
    startTime: m.start_time ? m.start_time.slice(0, 5) : null,
    endTime: m.end_time ? m.end_time.slice(0, 5) : null,
    scheduleText: null,
    durationMinutes: m.duration_minutes || null,
    places: m.positions ?? m.places ?? null,
    applicationUrl: null,
    isShort: m.duration_minutes > 0 && m.duration_minutes <= SHORT_MISSION_MAX_MINUTES,
  };
}

// Règle d'affichage unique : une mission rémunérée n'apparaît jamais tant
// que la couche rémunérée est en sommeil.
export function isVisibleKind(kind: MissionKind, paidLayer = features.paidLayer): boolean {
  return kind !== 'paid_mission' || paidLayer;
}

function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '');
}

export async function fetchExternalMissions(): Promise<ExternalMission[]> {
  const { data, error } = await supabase
    .from('external_missions')
    .select('*')
    .eq('is_active', true)
    .order('starts_at', { ascending: true, nullsFirst: false })
    .limit(300);
  // Tant que la migration phase 0 n'est pas appliquée, le catalogue externe
  // est simplement vide : l'app reste utilisable avec les missions natives.
  if (isMissingRelation(error)) return [];
  if (error) throw error;
  return data ?? [];
}

function isUpcoming(m: FeedMission, today: string): boolean {
  if (m.kind === 'external_solidarity_mission') return true; // filtré à l'import (is_active)
  return !m.date || m.date >= today;
}

export async function fetchSolidarityFeed(): Promise<FeedMission[]> {
  const [external, native] = await Promise.all([
    fetchExternalMissions(),
    // En navigation anonyme, la lecture des missions natives peut être
    // refusée : le catalogue externe suffit alors.
    fetchOpenMissions().catch(() => [] as MissionWithStructure[]),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return [...native.map(fromNativeMission), ...external.map(fromExternalMission)]
    .filter((m) => isVisibleKind(m.kind) && isUpcoming(m, today));
}

export function missionDistance(m: FeedMission, position: LatLng | null): number | null {
  if (!position || !m.coords) return null;
  return distanceKm(position, m.coords);
}

// Tri : les plus proches d'abord (si la position est connue), puis par date.
export function sortFeed(missions: FeedMission[], position: LatLng | null): FeedMission[] {
  return missions.slice().sort((a, b) => {
    const da = missionDistance(a, position);
    const db = missionDistance(b, position);
    if (da != null && db != null && Math.abs(da - db) > 0.05) return da - db;
    if (da != null && db == null) return -1;
    if (da == null && db != null) return 1;
    return (a.date ?? '9999').localeCompare(b.date ?? '9999');
  });
}

export function matchesSearch(m: FeedMission, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [m.title, m.organization.name, m.city ?? '', m.description ?? ''].some((v) => v.toLowerCase().includes(q));
}
