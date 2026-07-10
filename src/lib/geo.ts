// Geolocalisation legere, sans API externe : les missions UROSI sont dans la
// MEL, on geocode la commune saisie contre une table embarquee des principales
// communes. La distance est calculee cote client (formule de haversine) a
// partir de la position du navigateur — jamais stockee en base (RGPD).

export interface LatLng {
  lat: number;
  lng: number;
}

export const MEL_COMMUNES: Record<string, LatLng> = {
  lille: { lat: 50.6292, lng: 3.0573 },
  roubaix: { lat: 50.6927, lng: 3.1746 },
  tourcoing: { lat: 50.7235, lng: 3.161 },
  villeneuvedascq: { lat: 50.6236, lng: 3.1409 },
  wattrelos: { lat: 50.7042, lng: 3.2172 },
  marcqenbaroeul: { lat: 50.6708, lng: 3.0899 },
  lambersart: { lat: 50.6497, lng: 3.0253 },
  armentieres: { lat: 50.6881, lng: 2.8811 },
  croix: { lat: 50.6786, lng: 3.1494 },
  faches: { lat: 50.5911, lng: 3.0739 },
  fachesthumesnil: { lat: 50.5911, lng: 3.0739 },
  hem: { lat: 50.6553, lng: 3.1878 },
  halluin: { lat: 50.7836, lng: 3.1256 },
  laMadeleine: { lat: 50.6558, lng: 3.0709 },
  lamadeleine: { lat: 50.6558, lng: 3.0709 },
  loos: { lat: 50.6128, lng: 3.0186 },
  monsenbaroeul: { lat: 50.6417, lng: 3.1103 },
  mouvaux: { lat: 50.7031, lng: 3.1358 },
  ronchin: { lat: 50.6044, lng: 3.0908 },
  seclin: { lat: 50.5489, lng: 3.0303 },
  wasquehal: { lat: 50.6694, lng: 3.1308 },
  wattignies: { lat: 50.5856, lng: 3.0442 },
  wambrechies: { lat: 50.6853, lng: 3.05 },
  haubourdin: { lat: 50.6089, lng: 2.9861 },
  lezennes: { lat: 50.6136, lng: 3.1194 },
  lys: { lat: 50.6664, lng: 3.2497 },
  lyslezlannoy: { lat: 50.6664, lng: 3.2497 },
  saintandre: { lat: 50.6606, lng: 3.0447 },
  saintandrelezlille: { lat: 50.6606, lng: 3.0447 },
  quesnoysurdeule: { lat: 50.7106, lng: 3.0031 },
  comines: { lat: 50.7614, lng: 3.0086 },
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

// Geocode une saisie libre ("12 Rue de Béthune, Lille") en cherchant une
// commune MEL connue dans le texte. Retourne null si aucune ne matche.
export function geocodeMelCity(input: string): LatLng | null {
  const norm = normalize(input);
  if (!norm) return null;
  // Cherche la commune la plus longue contenue dans la saisie (evite que
  // "lys" matche avant "lyslezlannoy").
  let best: { key: string; coords: LatLng } | null = null;
  for (const [key, coords] of Object.entries(MEL_COMMUNES)) {
    if (norm.includes(key) && (!best || key.length > best.key.length)) {
      best = { key, coords };
    }
  }
  return best?.coords ?? null;
}

// Distance haversine en kilometres.
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}
