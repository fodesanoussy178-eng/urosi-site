// Conversion d'une mission API Engagement (https://api-engagement.beta.gouv.fr)
// en ligne `external_missions`. Module pur (aucun appel réseau) pour être
// testable hors Deno. Les noms de champs suivent l'API publique v0 ; chaque
// lecture est défensive : un champ absent donne null, jamais une erreur.

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
  external_id: string;
  title: string;
  description: string | null;
  organization_name: string | null;
  organization_logo_url: string | null;
  image_url: string | null;
  source_illustration_url: string | null;
  category: SolidarityCategory;
  city: string | null;
  postal_code: string | null;
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
  raw: unknown;
}

export const API_ENGAGEMENT_SOURCE = 'api_engagement';

type Json = Record<string, unknown>;

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function httpsUrl(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  try {
    const url = new URL(s);
    return url.protocol === 'https:' ? url.toString() : null;
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

export function stripHtml(value: string | null): string | null {
  if (!value) return null;
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

const KEYWORD_CATEGORIES: Array<[RegExp, SolidarityCategory]> = [
  [/alimentaire|colis|repas|maraude|restos?\b|épicerie solidaire|epicerie solidaire/i, 'aide_alimentaire'],
  [/festival|événement|evenement|concert|course solidaire|salon/i, 'evenementiel'],
  [/soutien scolaire|aide aux devoirs|tutorat|accompagnement scolaire|alphab/i, 'soutien_scolaire'],
];

const DOMAIN_CATEGORIES: Record<string, SolidarityCategory> = {
  'solidarite-insertion': 'solidarite',
  'vivre-ensemble': 'solidarite',
  humanitaire: 'solidarite',
  'cooperation-internationale': 'solidarite',
  environnement: 'environnement',
  animaux: 'environnement',
  education: 'soutien_scolaire',
  sante: 'sante',
  'prevention-protection': 'sante',
  sport: 'sport',
  'culture-loisirs': 'culture',
  'memoire-et-citoyennete': 'culture',
};

export function categorize(domain: string | null, title: string, description: string | null): SolidarityCategory {
  const haystack = `${title} ${description ?? ''}`;
  for (const [pattern, category] of KEYWORD_CATEGORIES) {
    if (pattern.test(haystack)) return category;
  }
  return (domain && DOMAIN_CATEGORIES[domain]) || 'autre';
}

// Retourne null si la mission ne peut pas être proposée : pas d'URL de
// candidature https, mission 100 % à distance, ou identifiant absent.
export function mapApiEngagementMission(input: unknown): ExternalMissionRow | null {
  if (!input || typeof input !== 'object') return null;
  const m = input as Json;
  const externalId = str(m._id) ?? str(m.id) ?? str(m.clientId);
  const title = str(m.title);
  const applicationUrl = httpsUrl(m.applicationUrl) ?? httpsUrl(m.url);
  if (!externalId || !title || !applicationUrl) return null;
  if (m.remote === 'full') return null;

  const description = stripHtml(str(m.description));
  const location = (m.location && typeof m.location === 'object' ? m.location : {}) as Json;
  const startsAt = isoDate(m.startAt);
  const endsAt = isoDate(m.endAt);
  let duration: number | null = null;
  if (startsAt && endsAt) {
    const minutes = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60000);
    // Au-delà d'une journée, la plage décrit une période de disponibilité,
    // pas la durée de la mission : on ne l'affiche pas comme une durée.
    if (minutes > 0 && minutes <= 12 * 60) duration = minutes;
  }

  return {
    source: API_ENGAGEMENT_SOURCE,
    external_id: externalId,
    title,
    description,
    organization_name: str(m.organizationName),
    organization_logo_url: httpsUrl(m.organizationLogo),
    // L'API ne fournit pas de photo de mission sous licence claire : on n'en
    // importe pas. L'illustration de domaine fournie par la source sert de
    // visuel, puis l'illustration UROSI de la catégorie côté client.
    image_url: null,
    source_illustration_url: httpsUrl(m.domainLogo),
    category: categorize(str(m.domain), title, description),
    city: str(m.city),
    postal_code: str(m.postalCode),
    address: str(m.address) ?? str(m.adresse),
    lat: num(location.lat),
    lng: num(location.lon) ?? num(location.lng),
    starts_at: startsAt,
    ends_at: endsAt,
    schedule_text: str(m.schedule),
    duration_minutes: duration,
    places: num(m.places),
    application_url: applicationUrl,
    source_url: httpsUrl(m.publisherUrl),
    is_active: m.deleted !== true && m.statusCode !== 'REFUSED',
    raw: input,
  };
}
