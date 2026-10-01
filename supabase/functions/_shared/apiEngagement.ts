// Conversion d'une mission API Engagement en ligne `external_missions`.
//
// Référence : documentation officielle de l'API Engagement, dépôt
// github.com/betagouv/api-engagement (api/docs/openapi.yaml, schéma
// MissionLegacy renvoyé par GET /v0/mission ; api/src/v0/mission/transformer.ts
// et constants.ts ; api/src/controllers/redirect.ts pour le tracking),
// relue sur le commit f67f348 du 25/09/2026.
//
// Points clés du contrat :
//   - `_id` (alias `id`) : identifiant unique de la mission côté API
//     Engagement → notre clé d'upsert. `clientId` n'est unique QUE par
//     annonceur (`publisherId`) : il est conservé pour le suivi, jamais
//     utilisé seul comme clé.
//   - `applicationUrl` : en v0 c'est déjà le lien TRACKÉ
//     `https://api.api-engagement.beta.gouv.fr/r/{missionId}/{diffuseurId}`,
//     qui compte le clic puis redirige vers la plateforme de l'annonceur.
//     Il doit être utilisé tel quel.
//   - adresses : `addresses[]` (street, postalCode, city, departmentCode,
//     departmentName, country, location{lat, lon}) ; les champs legacy
//     `address`, `city`, `postalCode`, `location` reprennent `addresses[0]`.
//   - `statusCode` ∈ ACCEPTED | REFUSED | PENDING | ONGOING ; `deleted` (bool)
//     et `deletedAt` pour les suppressions.
//   - `type` ∈ benevolat | volontariat_service_civique |
//     volontariat_sapeurs_pompiers | volontariat_reserve_operationnelle.
//   - `remote` ∈ no | possible | full | local.
//   - `duration` : durée en HEURES (entier, facultatif).
//   - `places` : entier ≥ 1, facultatif.
//   - `compensationAmount` : indemnisation. Phase 0 : aucune mission
//     indemnisée n'est importée (aucun montant ne doit apparaître).
// Module pur (aucun appel réseau) : testable hors Deno.

export type SolidarityCategory =
  | 'aide_alimentaire'
  | 'evenementiel'
  | 'soutien_scolaire'
  | 'environnement'
  | 'solidarite'
  | 'sport'
  | 'culture'
  | 'sante'
  | 'autre';

export interface ExternalMissionRow {
  source: string;
  source_type: string;
  source_name: string;
  external_id: string;
  client_id: string | null;
  publisher_id: string | null;
  publisher_name: string | null;
  publisher_url: string | null;
  publisher_logo_url: string | null;
  mission_type: string | null;
  domain: string | null;
  activities: string[];
  status_code: string | null;
  remote: string | null;
  title: string;
  description: string | null;
  organization_name: string | null;
  organization_logo_url: string | null;
  organization_url: string | null;
  organization_rna: string | null;
  organization_siren: string | null;
  organization_status_juridique: string | null;
  // Photo de mission fournie par la source (niveau 2). Toujours null pour
  // l'API Engagement v0 : aucun champ photo dans la réponse.
  image_url: string | null;
  // Obsolète, conservé pour compatibilité : même valeur que domain_logo_url.
  source_illustration_url: string | null;
  domain_logo_url: string | null;
  category: SolidarityCategory;
  city: string | null;
  postal_code: string | null;
  department_code: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  starts_at: string | null;
  ends_at: string | null;
  schedule_text: string | null;
  duration_minutes: number | null;
  places: number | null;
  application_url: string;
  source_url: string | null;
  is_active: boolean;
  source_created_at: string | null;
  source_updated_at: string | null;
  source_deleted_at: string | null;
  raw: unknown;
}

export const API_ENGAGEMENT_SOURCE = 'api_engagement';
export const API_ENGAGEMENT_PROD_URL = 'https://api.api-engagement.beta.gouv.fr';

// Seule catégorie importée en phase 0 : le bénévolat. Les volontariats
// (Service Civique, sapeurs-pompiers, réserve) sont indemnisés ou encadrés
// par un contrat : hors périmètre des missions solidaires courtes.
export const PHASE0_MISSION_TYPES = ['benevolat'];

export type SkipReason =
  | 'invalid'
  | 'missing_application_url'
  | 'deleted'
  | 'not_accepted'
  | 'remote_full'
  | 'type_excluded'
  | 'compensated'
  | 'expired';

// En cas de rejet, l'identifiant externe (s'il est lisible) permet de
// désactiver une mission déjà importée qui ne remplit plus les conditions.
export type MapResult = { ok: true; row: ExternalMissionRow } | { ok: false; reason: SkipReason; externalId: string | null };

type Json = Record<string, unknown>;

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function num(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function httpsUrl(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  try {
    return new URL(s).protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}

function isoDate(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str).filter((v): v is string => Boolean(v)) : [];
}

export function stripHtml(value: string | null): string | null {
  if (!value) return null;
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

// Mots-clés d'abord (titre + description + activités), puis domaine officiel.
const KEYWORD_CATEGORIES: Array<[RegExp, SolidarityCategory]> = [
  [/alimentaire|colis|repas|maraude|restos?\b|épicerie solidaire|epicerie solidaire|\bdistribution\b/i, 'aide_alimentaire'],
  [/festival|événement|evenement|concert|course solidaire|salon\b/i, 'evenementiel'],
  [/soutien scolaire|soutien-scolaire|aide aux devoirs|tutorat|accompagnement scolaire|alphab/i, 'soutien_scolaire'],
];

// Valeurs possibles de `domain` (doc officielle), rattachées aux catégories UROSI.
export const DOMAIN_CATEGORIES: Record<string, SolidarityCategory> = {
  animaux: 'environnement',
  autre: 'autre',
  'batiment-industrie-logistique': 'autre',
  'benevolat-competences': 'solidarite',
  communication: 'autre',
  'culture-loisirs': 'culture',
  education: 'soutien_scolaire',
  emploi: 'solidarite',
  environnement: 'environnement',
  'gestion-finance-droit': 'autre',
  humanitaire: 'solidarite',
  'memoire-et-citoyennete': 'culture',
  numerique: 'autre',
  'prevention-protection': 'sante',
  recherche: 'autre',
  sante: 'sante',
  'service-public-defense-securite': 'autre',
  sport: 'sport',
  'solidarite-insertion': 'solidarite',
  'vivre-ensemble': 'solidarite',
};

export function categorize(domain: string | null, title: string, description: string | null, activities: string[] = []): SolidarityCategory {
  const haystack = `${title} ${description ?? ''} ${activities.join(' ')}`;
  for (const [pattern, category] of KEYWORD_CATEGORIES) {
    if (pattern.test(haystack)) return category;
  }
  return (domain && DOMAIN_CATEGORIES[domain]) || 'autre';
}

interface Place {
  street: string | null;
  city: string | null;
  postalCode: string | null;
  departmentCode: string | null;
  lat: number | null;
  lng: number | null;
}

function placeOf(a: Json): Place {
  const loc = (a.location && typeof a.location === 'object' ? a.location : {}) as Json;
  return {
    street: str(a.street) ?? str(a.address),
    city: str(a.city),
    postalCode: str(a.postalCode) ?? str(a.zip),
    departmentCode: str(a.departmentCode) ?? str(a.department),
    lat: num(loc.lat),
    lng: num(loc.lon) ?? num(loc.lng),
  };
}

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Une mission peut avoir plusieurs lieux : on retient le plus proche du
// centre d'import (la MEL), sinon le premier, sinon les champs legacy.
function pickPlace(m: Json, center?: { lat: number; lng: number }): Place {
  const places = (Array.isArray(m.addresses) ? m.addresses : [])
    .filter((a): a is Json => Boolean(a) && typeof a === 'object')
    .map(placeOf);
  const legacy = placeOf(m);
  if (places.length === 0) return legacy;
  if (center) {
    const located = places.filter((p) => p.lat != null && p.lng != null);
    if (located.length > 0) {
      return located.reduce((best, p) =>
        distance(center, { lat: p.lat!, lng: p.lng! }) < distance(center, { lat: best.lat!, lng: best.lng! }) ? p : best,
      );
    }
  }
  return places[0] ?? legacy;
}

export function mapApiEngagementMission(
  input: unknown,
  options: { now?: Date; center?: { lat: number; lng: number }; baseUrl?: string } = {},
): MapResult {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'invalid', externalId: null };
  const m = input as Json;
  const now = options.now ?? new Date();

  const externalId = str(m._id) ?? str(m.id);
  const title = str(m.title);
  const skip = (reason: SkipReason): MapResult => ({ ok: false, reason, externalId });
  if (!externalId || !title) return skip('invalid');

  const applicationUrl = httpsUrl(m.applicationUrl);
  if (!applicationUrl) return skip('missing_application_url');

  const deletedAt = isoDate(m.deletedAt);
  if (m.deleted === true || deletedAt) return skip('deleted');

  const statusCode = str(m.statusCode);
  if (statusCode && statusCode !== 'ACCEPTED') return skip('not_accepted');

  const remote = str(m.remote);
  if (remote === 'full') return skip('remote_full');

  const missionType = str(m.type);
  if (missionType && !PHASE0_MISSION_TYPES.includes(missionType)) return skip('type_excluded');

  const compensation = num(m.compensationAmount);
  if (compensation != null && compensation > 0) return skip('compensated');

  const startsAt = isoDate(m.startAt);
  const endsAt = isoDate(m.endAt);
  if (endsAt && Date.parse(endsAt) < now.getTime()) return skip('expired');

  const description = stripHtml(str(m.descriptionHtml) ?? str(m.description));
  const activities = strArray(m.activities).length > 0 ? strArray(m.activities) : (str(m.activity)?.split(',').map((a) => a.trim()).filter(Boolean) ?? []);
  const place = pickPlace(m, options.center);

  // `duration` est exprimée en heures par l'API. À défaut, une plage
  // début/fin de moins de 12 h sur la même journée donne la durée ; au-delà,
  // c'est une période de disponibilité, pas une durée de mission.
  let durationMinutes: number | null = null;
  const durationHours = num(m.duration);
  if (durationHours != null && durationHours > 0 && durationHours <= 72) {
    durationMinutes = Math.round(durationHours * 60);
  } else if (startsAt && endsAt) {
    const minutes = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60000);
    if (minutes > 0 && minutes <= 12 * 60) durationMinutes = minutes;
  }

  const places = num(m.places);

  return {
    ok: true,
    row: {
      source: API_ENGAGEMENT_SOURCE,
      source_type: 'api',
      source_name: 'API Engagement',
      external_id: externalId,
      client_id: str(m.clientId),
      publisher_id: str(m.publisherId),
      publisher_name: str(m.publisherName),
      publisher_url: httpsUrl(m.publisherUrl),
      publisher_logo_url: httpsUrl(m.publisherLogo),
      mission_type: missionType,
      domain: str(m.domain),
      activities,
      status_code: statusCode,
      remote,
      title,
      description,
      organization_name: str(m.organizationName) ?? str(m.associationName),
      organization_logo_url: httpsUrl(m.organizationLogo) ?? httpsUrl(m.associationLogo),
      organization_url: httpsUrl(m.organizationUrl),
      organization_rna: str(m.organizationRNA) ?? str(m.associationRNA),
      organization_siren: str(m.organizationSiren) ?? str(m.associationSiren),
      organization_status_juridique: str(m.organizationStatusJuridique),
      // GET /v0/mission ne renvoie AUCUNE photo de mission : les seuls
      // visuels sont des logos (MISSION_FIELDS, api/src/v0/mission/constants.ts).
      // Le champ `image` du schéma d'écriture v2 n'est pas exposé en v0 :
      // il n'est jamais lu ici. organizationLogo reste un LOGO.
      image_url: null,
      source_illustration_url: httpsUrl(m.domainLogo),
      domain_logo_url: httpsUrl(m.domainLogo),
      category: categorize(str(m.domain), title, description, activities),
      city: place.city,
      postal_code: place.postalCode,
      department_code: place.departmentCode,
      address: place.street,
      lat: place.lat,
      lng: place.lng,
      starts_at: startsAt,
      ends_at: endsAt,
      schedule_text: str(m.schedule),
      duration_minutes: durationMinutes,
      places: places != null && places >= 0 ? Math.floor(places) : null,
      application_url: applicationUrl,
      // Provenance exacte : la fiche de la mission dans l'API (GET /v0/mission/{id}).
      source_url: `${(options.baseUrl ?? API_ENGAGEMENT_PROD_URL).replace(/\/+$/, '')}/v0/mission/${encodeURIComponent(externalId)}`,
      is_active: true,
      source_created_at: isoDate(m.createdAt),
      source_updated_at: isoDate(m.updatedAt),
      source_deleted_at: null,
      raw: input,
    },
  };
}

// Tracking diffuseur : l'impression d'une mission se déclare sur
// GET /r/impression/{missionId}/{diffuseurId}, dérivé du lien tracké.
export function impressionUrlFromApplicationUrl(applicationUrl: string): string | null {
  const match = /^(https:\/\/[^/]+)\/r\/([^/?#]+)\/([^/?#]+)/.exec(applicationUrl);
  if (!match || match[2] === 'impression') return null;
  return `${match[1]}/r/impression/${match[2]}/${match[3]}`;
}
