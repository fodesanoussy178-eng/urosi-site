// Comportement 1 : « J'arrive → je vois des missions ». UROSI demande la
// localisation ; si elle est refusée, seulement la ville. Rien d'autre.
//
// La position reste sur l'appareil (arrondie à ~100 m), jamais en base.
// Commune détectée via l'API Adresse de l'État (reverse), sinon la commune
// connue la plus proche.
import { useCallback, useEffect, useState } from 'react';
import { distanceKm, type LatLng } from '@/lib/geo';
import type { FeedMission } from '@/features/missions/solidarityMissions';

export interface UserLocation extends LatLng {
  city: string;
  source: 'gps' | 'city';
}

export type LocationPhase = 'asking' | 'ready' | 'need_city';

const STORAGE_KEY = 'urosi_location_v1';

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

// Commune de la position (API Adresse, data.gouv.fr), sinon la plus proche connue.
export async function reverseCity(point: LatLng): Promise<string> {
  try {
    const body = (await fetchJson(`https://api-adresse.data.gouv.fr/reverse/?lon=${point.lng}&lat=${point.lat}&type=municipality&limit=1`)) as {
      features?: Array<{ properties?: { city?: string; name?: string } }>;
    };
    const city = body.features?.[0]?.properties?.city ?? body.features?.[0]?.properties?.name;
    if (city) return city;
  } catch {
    // réseau indisponible : secours local
  }
  return nearestKnownCommune(point);
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function readStoredLocation(): UserLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<UserLocation>) : null;
    if (v && typeof v.lat === 'number' && typeof v.lng === 'number' && typeof v.city === 'string' && (v.source === 'gps' || v.source === 'city')) {
      return v as UserLocation;
    }
  } catch {
    // stockage indisponible
  }
  return null;
}

function store(location: UserLocation | null) {
  try {
    if (location) localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // stockage indisponible : la position vaut pour la visite
  }
}

export function useUserLocation() {
  const [location, setLocation] = useState<UserLocation | null>(() => readStoredLocation());
  const [phase, setPhase] = useState<LocationPhase>(() => (readStoredLocation() ? 'ready' : 'asking'));

  const askGps = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setPhase('need_city');
      return;
    }
    setPhase('asking');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const point = { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude) };
        const city = await reverseCity(point);
        const next: UserLocation = { ...point, city, source: 'gps' };
        store(next);
        setLocation(next);
        setPhase('ready');
      },
      () => setPhase('need_city'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }, []);

  useEffect(() => {
    if (!location) askGps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseCity = useCallback(async (query: string): Promise<boolean> => {
    const found = await searchCity(query);
    if (!found) return false;
    const next: UserLocation = { lat: found.lat, lng: found.lng, city: found.name, source: 'city' };
    store(next);
    setLocation(next);
    setPhase('ready');
    return true;
  }, []);

  const changeCity = useCallback(() => {
    setPhase('need_city');
  }, []);

  return { location, phase, askGps, chooseCity, changeCity };
}
