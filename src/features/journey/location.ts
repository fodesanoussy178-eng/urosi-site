// Comportement 1 : « J'arrive → je vois des missions ». UROSI demande la
// localisation ; si elle est refusée, seulement la ville. Rien d'autre.
//
// Demandée uniquement ici, pour trier les missions par proximité. Aucun
// rayon, département, région ni adresse personnelle n'est demandé. La
// position n'est jamais envoyée en base ; voir useUserLocation pour sa durée
// de conservation.
import { useCallback, useEffect, useState } from 'react';
import { distanceKm, type LatLng } from '@/lib/geo';
import type { FeedMission } from '@/features/missions/solidarityMissions';

export interface UserLocation extends LatLng {
  city: string;
  source: 'gps' | 'city';
}

export type LocationPhase = 'asking' | 'ready' | 'need_city';


// Communes de la métropole (secours hors ligne, recherche instantanée).
export const KNOWN_COMMUNES: Array<{ name: string } & LatLng> = [
  { name: 'Lille', lat: 50.6292, lng: 3.0573 },
  { name: 'Roubaix', lat: 50.6927, lng: 3.1746 },
  { name: 'Tourcoing', lat: 50.7235, lng: 3.161 },
  { name: 'Villeneuve-d’Ascq', lat: 50.6236, lng: 3.1409 },
  { name: 'Wattrelos', lat: 50.7042, lng: 3.2172 },
  { name: 'Marcq-en-Barœul', lat: 50.6708, lng: 3.0899 },
  { name: 'Lambersart', lat: 50.6497, lng: 3.0253 },
  { name: 'Armentières', lat: 50.6881, lng: 2.8811 },
  { name: 'Croix', lat: 50.6786, lng: 3.1494 },
  { name: 'Faches-Thumesnil', lat: 50.5911, lng: 3.0739 },
  { name: 'Hem', lat: 50.6553, lng: 3.1878 },
  { name: 'Halluin', lat: 50.7836, lng: 3.1256 },
  { name: 'La Madeleine', lat: 50.6558, lng: 3.0709 },
  { name: 'Loos', lat: 50.6128, lng: 3.0186 },
  { name: 'Mons-en-Barœul', lat: 50.6417, lng: 3.1103 },
  { name: 'Mouvaux', lat: 50.7031, lng: 3.1358 },
  { name: 'Ronchin', lat: 50.6044, lng: 3.0908 },
  { name: 'Seclin', lat: 50.5489, lng: 3.0303 },
  { name: 'Wasquehal', lat: 50.6694, lng: 3.1308 },
  { name: 'Wattignies', lat: 50.5856, lng: 3.0442 },
  { name: 'Wambrechies', lat: 50.6853, lng: 3.05 },
  { name: 'Haubourdin', lat: 50.6089, lng: 2.9861 },
  { name: 'Lezennes', lat: 50.6136, lng: 3.1194 },
  { name: 'Lys-lez-Lannoy', lat: 50.6664, lng: 3.2497 },
  { name: 'Saint-André-lez-Lille', lat: 50.6606, lng: 3.0447 },
  { name: 'Quesnoy-sur-Deûle', lat: 50.7106, lng: 3.0031 },
  { name: 'Comines', lat: 50.7614, lng: 3.0086 },
];

export function normalizeCity(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(cedex|arrondissement)\b.*$/, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeCity(a);
  return na.length > 0 && na === normalizeCity(b);
}

export function nearestKnownCommune(point: LatLng): string {
  let best = KNOWN_COMMUNES[0]!;
  for (const c of KNOWN_COMMUNES) if (distanceKm(point, c) < distanceKm(point, best)) best = c;
  return best.name;
}

export function findKnownCommune(name: string): ({ name: string } & LatLng) | null {
  const n = normalizeCity(name);
  return KNOWN_COMMUNES.find((c) => normalizeCity(c.name) === n) ?? null;
}

// « Près de moi » : proximité réelle, même de l'autre côté d'une limite de
// commune. Les missions sans coordonnées passent après, par date.
export function missionsNearMe(missions: FeedMission[], at: LatLng): Array<{ mission: FeedMission; distance: number | null }> {
  return missions
    .map((mission) => ({ mission, distance: mission.coords ? distanceKm(at, mission.coords) : null }))
    .sort((a, b) => {
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      if (a.distance != null) return -1;
      if (b.distance != null) return 1;
      return (a.mission.date ?? '9999').localeCompare(b.mission.date ?? '9999');
    });
}

// « Voir dans ma ville » : uniquement la commune détectée, jamais au-delà.
export function missionsInCity(missions: FeedMission[], city: string, at: LatLng | null): Array<{ mission: FeedMission; distance: number | null }> {
  return missions
    .filter((m) => sameCity(m.city, city))
    .map((mission) => ({ mission, distance: at && mission.coords ? distanceKm(at, mission.coords) : null }))
    .sort((a, b) => (a.mission.date ?? '9999').localeCompare(b.mission.date ?? '9999') || (a.distance ?? 0) - (b.distance ?? 0));
}

async function fetchJson(url: string, timeoutMs = 4000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Commune de la position (API Adresse, data.gouv.fr) et son point de
// référence public ; sinon la commune connue la plus proche.
export async function reverseCity(point: LatLng): Promise<{ name: string } & LatLng> {
  try {
    const body = (await fetchJson(`https://api-adresse.data.gouv.fr/reverse/?lon=${point.lng}&lat=${point.lat}&type=municipality&limit=1`)) as {
      features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: { city?: string; name?: string } }>;
    };
    const feature = body.features?.[0];
    const name = feature?.properties?.city ?? feature?.properties?.name;
    const coords = feature?.geometry?.coordinates;
    if (name) {
      const known = findKnownCommune(name);
      if (known) return known;
      if (coords) return { name, lat: coords[1], lng: coords[0] };
      return { name, lat: round(point.lat, 2), lng: round(point.lng, 2) };
    }
  } catch {
    // réseau indisponible : secours local
  }
  const nearest = nearestKnownCommune(point);
  return findKnownCommune(nearest)!;
}

// Recherche d'une commune saisie (API Découpage administratif, geo.api.gouv.fr).
export async function searchCity(query: string): Promise<({ name: string } & LatLng) | null> {
  const known = findKnownCommune(query);
  if (known) return known;
  try {
    const body = (await fetchJson(`https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(query.trim())}&fields=nom,centre&boost=population&limit=1`)) as Array<{
      nom: string;
      centre?: { coordinates?: [number, number] };
    }>;
    const first = body[0];
    const coords = first?.centre?.coordinates;
    if (first && coords) return { name: first.nom, lat: coords[1], lng: coords[0] };
  } catch {
    // réseau indisponible
  }
  return null;
}

function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// Deux mémoires distinctes :
//   - la COMMUNE (nom + point de référence public de la commune) reste sur
//     l'appareil pour ne pas redemander à chaque visite ;
//   - la POSITION GPS (arrondie à ~100 m) ne vit que le temps de l'onglet
//     (sessionStorage) : jamais conservée durablement, jamais envoyée en base.
const PLACE_KEY = 'urosi_place_v1';
const POSITION_KEY = 'urosi_position_v1';
const LEGACY_KEY = 'urosi_location_v1';

interface StoredPlace extends LatLng {
  city: string;
  source: 'gps' | 'city';
}

function readJson<T>(storage: Storage | undefined, key: string): T | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage | undefined, key: string, value: unknown) {
  try {
    if (value == null) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible : valable pour la visite seulement
  }
}

function local(): Storage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function session(): Storage | undefined {
  return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
}

function readPlace(): StoredPlace | null {
  const v = readJson<Partial<StoredPlace>>(local(), PLACE_KEY);
  return v && typeof v.city === 'string' && typeof v.lat === 'number' && typeof v.lng === 'number' && (v.source === 'gps' || v.source === 'city') ? (v as StoredPlace) : null;
}

function readPosition(): LatLng | null {
  const v = readJson<Partial<LatLng>>(session(), POSITION_KEY);
  return v && typeof v.lat === 'number' && typeof v.lng === 'number' ? { lat: v.lat, lng: v.lng } : null;
}

// Position GPS de la visite en cours (distance réelle sur la fiche), sinon null.
export function readStoredLocation(): LatLng | null {
  return readPosition();
}

function currentLocation(): UserLocation | null {
  const place = readPlace();
  if (!place) return null;
  const position = place.source === 'gps' ? readPosition() : null;
  if (place.source === 'gps' && !position) return null;
  return position ? { ...position, city: place.city, source: 'gps' } : { lat: place.lat, lng: place.lng, city: place.city, source: 'city' };
}

async function geolocationPermission(): Promise<PermissionState | 'unknown'> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return status?.state ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function useUserLocation() {
  const [location, setLocation] = useState<UserLocation | null>(() => currentLocation());
  const [phase, setPhase] = useState<LocationPhase>(() => (currentLocation() ? 'ready' : 'asking'));

  const askGps = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setPhase('need_city');
      return;
    }
    setPhase('asking');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const point = { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude) };
        const commune = await reverseCity(point);
        writeJson(session(), POSITION_KEY, point);
        writeJson(local(), PLACE_KEY, { city: commune.name, lat: commune.lat, lng: commune.lng, source: 'gps' });
        setLocation({ ...point, city: commune.name, source: 'gps' });
        setPhase('ready');
      },
      () => {
        // Refus ou échec : on ne demande que la ville.
        const place = readPlace();
        if (place) {
          setLocation({ lat: place.lat, lng: place.lng, city: place.city, source: 'city' });
          setPhase('ready');
        } else {
          setPhase('need_city');
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }, []);

  useEffect(() => {
    writeJson(local(), LEGACY_KEY, null); // ancienne clé : position conservée durablement
    if (location) return;
    let alive = true;
    void geolocationPermission().then((permission) => {
      if (!alive) return;
      const place = readPlace();
      if (permission === 'granted') {
        askGps(); // déjà autorisée : aucune question affichée
      } else if (permission === 'denied' || place?.source === 'city') {
        // Refusée, ou ville déjà choisie : on ne redemande pas.
        if (place) {
          setLocation({ lat: place.lat, lng: place.lng, city: place.city, source: 'city' });
          setPhase('ready');
        } else {
          setPhase('need_city');
        }
      } else {
        askGps();
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseCity = useCallback(async (query: string): Promise<boolean> => {
    const found = await searchCity(query);
    if (!found) return false;
    writeJson(session(), POSITION_KEY, null);
    writeJson(local(), PLACE_KEY, { city: found.name, lat: found.lat, lng: found.lng, source: 'city' });
    setLocation({ lat: found.lat, lng: found.lng, city: found.name, source: 'city' });
    setPhase('ready');
    return true;
  }, []);

  const changeCity = useCallback(() => setPhase('need_city'), []);

  return { location, phase, askGps, chooseCity, changeCity };
}
