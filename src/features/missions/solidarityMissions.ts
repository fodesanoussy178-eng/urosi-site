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
import { demoMissions, demoMissionsEnabled } from './demoMissions';
import { fetchPrimaryImages } from './missionImagesService';

export type MissionKind = 'external_solidarity_mission' | 'urosi_solidarity_mission' | 'paid_mission';
export type PhotoLevel = 'native_photo' | 'partner_mission_image' | 'authorized_image';

const PUBLISHABLE_RIGHTS = new Set(['source_provided', 'licensed', 'authorized']);

// Photo d'une mission importée : seulement si l'agent l'a retenue comme
// photo (jamais un logo) et que ses droits sont connus.
export function externalPhoto(m: Pick<ExternalMission, 'image_url' | 'image_source' | 'image_rights_status'>): { url: string; level: PhotoLevel } | null {
  if (!m.image_url) return null;
  if (m.image_source !== 'partner_mission_image' && m.image_source !== 'authorized_image') return null;
  if (!PUBLISHABLE_RIGHTS.has(m.image_rights_status ?? '')) return null;
  return { url: m.image_url, level: m.image_source };
}
export type ExternalMission = Database['public']['Tables']['external_missions']['Row'];

export interface FeedMission {
  key: string;
  id: string;
  kind: MissionKind;
  source: string;
  title: string;
  description: string | null;
  organization: { id: string | null; name: string; logoUrl: string | null; verified: boolean };
  // Visuels, hiérarchie commune (supabase/functions/_shared/missionVisual.ts) :
  // photo (native ou partenaire, droits connus) > logo de l'organisation >
  // logo du domaine > illustration UROSI de la catégorie.
  imageUrl: string | null;
  imageLevel: PhotoLevel | null;
  domainLogoUrl: string | null;
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
  // Lien de candidature. Pour une mission API Engagement, c'est le lien
  // tracké officiel (compte le clic puis redirige vers l'annonceur).
  applicationUrl: string | null;
  // Plateforme où la candidature se poursuit (ex. « JeVeuxAider.gouv.fr »).
  partnerName: string | null;
  // Tracking diffuseur API Engagement : impression d'une mission affichée.
  impressionUrl: string | null;
  isShort: boolean;
  // Mission d'exemple (catalogue vide) : jamais candidatable, toujours signalée.
  isDemo?: boolean;
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

// Libellé affiché pour « Tu continueras ta candidature sur … ». Le lien
// tracké pointe vers api-engagement.beta.gouv.fr : on affiche le nom de la
// plateforme de l'annonceur plutôt que ce domaine technique.
export function partnerLabel(mission: Pick<FeedMission, 'partnerName' | 'applicationUrl'>): string | null {
  if (mission.partnerName) return mission.partnerName;
  const host = partnerHost(mission.applicationUrl);
  return host && !host.endsWith('api-engagement.beta.gouv.fr') ? host : null;
}

// Tracking diffuseur (doc API Engagement) : l'impression se déclare sur
// GET /r/impression/{missionId}/{diffuseurId}, dérivé du lien tracké
// https://api.api-engagement.beta.gouv.fr/r/{missionId}/{diffuseurId}.
export function impressionUrlFor(applicationUrl: string | null): string | null {
  if (!applicationUrl) return null;
  const match = /^(https:\/\/[^/]*api-engagement\.beta\.gouv\.fr)\/r\/([^/?#]+)\/([^/?#]+)/.exec(applicationUrl);
  if (!match || match[2] === 'impression') return null;
  return `${match[1]}/r/impression/${match[2]}/${match[3]}`;
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
  const photo = externalPhoto(m);
  return {
    key: `external:${m.id}`,
    id: m.id,
    kind: 'external_solidarity_mission',
    source: m.source,
    title: m.title,
    description: m.description,
    organization: { id: null, name: m.organization_name || 'Association partenaire', logoUrl: m.organization_logo_url, verified: false },
    imageUrl: photo?.url ?? null,
    imageLevel: photo?.level ?? null,
    domainLogoUrl: m.domain_logo_url ?? m.source_illustration_url,
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
    partnerName: m.publisher_name,
    impressionUrl: m.source === 'api_engagement' ? impressionUrlFor(m.application_url) : null,
    isShort: m.duration_minutes != null && m.duration_minutes <= SHORT_MISSION_MAX_MINUTES,
  };
}

export function fromNativeMission(m: MissionWithStructure, primaryImageUrl: string | null = null): FeedMission {
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
    imageUrl: primaryImageUrl,
    imageLevel: primaryImageUrl ? 'native_photo' : null,
    domainLogoUrl: null,
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
    partnerName: null,
    impressionUrl: null,
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

// Vue publique (sans compte) : missions solidaires natives ouvertes, colonnes
// non sensibles uniquement (migration phase 0, section 7).
export interface PublicSolidarityMission {
  id: string;
  structure_id: string;
  title: string;
  detail: string | null;
  city: string | null;
  address: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
  scheduled_date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  mission_category: string;
  places: number;
  positions: number | null;
  structure_name: string;
  structure_logo_url: string | null;
  structure_verification_status: string;
  // Photo principale fournie par la structure (migration 20260927120000).
  primary_image_url?: string | null;
  image_count?: number | null;
}

export function fromPublicMission(m: PublicSolidarityMission): FeedMission {
  return {
    key: `urosi:${m.id}`,
    id: m.id,
    kind: 'urosi_solidarity_mission',
    source: 'urosi',
    title: m.title,
    description: m.detail,
    organization: { id: m.structure_id, name: m.structure_name || 'Structure', logoUrl: m.structure_logo_url, verified: true },
    imageUrl: m.primary_image_url ?? null,
    imageLevel: m.primary_image_url ? 'native_photo' : null,
    domainLogoUrl: null,
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
    partnerName: null,
    impressionUrl: null,
    isShort: m.duration_minutes > 0 && m.duration_minutes <= SHORT_MISSION_MAX_MINUTES,
  };
}

export async function fetchPublicSolidarityMissions(): Promise<PublicSolidarityMission[]> {
  const { data, error } = await supabase.from('public_solidarity_missions' as never).select('*').order('scheduled_date', { ascending: true }).limit(300);
  if (isMissingRelation(error)) return [];
  if (error) throw error;
  return (data ?? []) as unknown as PublicSolidarityMission[];
}

async function fetchNativeFeed(): Promise<FeedMission[]> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return (await fetchPublicSolidarityMissions()).map(fromPublicMission);
  const missions = await fetchOpenMissions();
  const photos = await fetchPrimaryImages(missions.filter((m) => m.is_solidaire).map((m) => m.id)).catch(() => new Map<string, string>());
  return missions.map((m) => fromNativeMission(m, photos.get(m.id) ?? null));
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
  // Les doublons sont masqués par RLS, sauf pour l'équipe UROSI qui lit tout :
  // le fil ne les montre jamais.
  return (data ?? []).filter((m) => !m.duplicate_of_external && !m.duplicate_of_mission);
}

function isUpcoming(m: FeedMission, today: string): boolean {
  if (m.kind === 'external_solidarity_mission') return true; // filtré à l'import (is_active)
  return !m.date || m.date >= today;
}

// Aucune source ne doit bloquer l'écran : au-delà de ce délai, elle est
// considérée comme vide (le fil affiche l'autre source ou un état vide).
export const FEED_SOURCE_TIMEOUT_MS = 8000;

function settle<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<{ value: T; failed: boolean }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ value: fallback, failed: true }), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ value, failed: false });
      },
      () => {
        clearTimeout(timer);
        resolve({ value: fallback, failed: true });
      },
    );
  });
}

export interface FeedResult {
  missions: FeedMission[];
  // true si les deux sources ont échoué (réseau) : l'écran le signale.
  unavailable: boolean;
}

export async function fetchSolidarityFeedResult(timeoutMs = FEED_SOURCE_TIMEOUT_MS): Promise<FeedResult> {
  const [externalResult, nativeResult] = await Promise.all([
    // Catalogue externe vide (et non en erreur) tant que l'import API
    // Engagement n'est pas configuré : les missions natives s'affichent seules.
    settle(fetchExternalMissions(), [] as ExternalMission[], timeoutMs),
    // Sans compte : vue publique des missions solidaires natives.
    settle(fetchNativeFeed(), [] as FeedMission[], timeoutMs),
  ]);
  const external = externalResult.value;
  const native = nativeResult.value;
  const today = new Date().toISOString().slice(0, 10);
  const missions = [...native, ...external.map(fromExternalMission)].filter(
    (m) => isVisibleKind(m.kind) && isUpcoming(m, today),
  );
  return { missions, unavailable: externalResult.failed && nativeResult.failed };
}

export async function fetchSolidarityFeed(): Promise<FeedMission[]> {
  return (await fetchSolidarityFeedResult()).missions;
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

export interface PublicCatalog {
  missions: FeedMission[];
  // true : aucune mission réelle disponible, missions d'exemple affichées.
  demo: boolean;
}

// Catalogue des pages publiques : jamais vide ni bloqué. Tant qu'aucune
// mission réelle n'est disponible (import non configuré, aucune mission
// native), des missions d'exemple clairement signalées prennent le relais.
export async function fetchPublicCatalog(timeoutMs = FEED_SOURCE_TIMEOUT_MS): Promise<PublicCatalog> {
  const result = await fetchSolidarityFeedResult(timeoutMs);
  if (result.missions.length > 0 || !demoMissionsEnabled) return { missions: result.missions, demo: false };
  return { missions: demoMissions(), demo: true };
}
