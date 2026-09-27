import { describe, expect, it } from 'vitest';
import { categorize, impressionUrlFromApplicationUrl, mapApiEngagementMission, stripHtml } from './apiEngagement';

const NOW = new Date('2026-09-26T12:00:00Z');

// Forme d'une mission telle que renvoyée par GET /v0/mission (MissionLegacy,
// api/src/v0/mission/transformer.ts) : champs de MISSION_FIELDS + champs
// legacy dérivés de addresses[0] + applicationUrl tracké.
const base = {
  _id: '66f1a2b3c4d5e6f7a8b9c0d1',
  id: '66f1a2b3c4d5e6f7a8b9c0d1',
  clientId: 'mission-123',
  publisherId: '5f5931496c7ea514150a818f',
  publisherName: 'JeVeuxAider.gouv.fr',
  publisherUrl: 'https://www.jeveuxaider.gouv.fr',
  publisherLogo: 'https://cdn.example.org/jva.png',
  statusCode: 'ACCEPTED',
  type: 'benevolat',
  title: 'Distribution de colis alimentaires',
  description: '<p>Aider à la <b>préparation</b>&nbsp;des colis.</p>',
  domain: 'solidarite-insertion',
  domainLogo: 'https://cdn.example.org/domain.jpg',
  activity: 'distribution, logistique',
  remote: 'no',
  places: 8,
  duration: 3,
  schedule: 'Le samedi matin',
  startAt: '2026-10-03T07:00:00.000Z',
  endAt: '2026-10-03T10:00:00.000Z',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-20T09:00:00.000Z',
  deletedAt: null,
  deleted: false,
  organizationName: 'Banque Alimentaire du Nord',
  organizationLogo: 'https://cdn.example.org/logo.png',
  organizationRNA: 'W595000000',
  addresses: [
    { street: '1 rue de Paris', postalCode: '75001', city: 'Paris', departmentCode: '75', location: { lat: 48.86, lon: 2.34 } },
    { street: '12 rue Pierre Legrand', postalCode: '59800', city: 'Lille', departmentCode: '59', location: { lat: 50.63, lon: 3.09 } },
  ],
  city: 'Paris',
  postalCode: '75001',
  location: { lat: 48.86, lon: 2.34 },
  applicationUrl: 'https://api.api-engagement.beta.gouv.fr/r/66f1a2b3c4d5e6f7a8b9c0d1/65aa00000000000000000001',
};

const LILLE = { lat: 50.6292, lng: 3.0573 };

function ok(input: unknown) {
  const result = mapApiEngagementMission(input, { now: NOW, center: LILLE });
  if (!result.ok) throw new Error(`rejetée : ${result.reason}`);
  return result.row;
}

describe('import API Engagement (contrat officiel v0)', () => {
  it('utilise _id comme clé et conserve clientId / publisherId pour le suivi', () => {
    const row = ok(base);
    expect(row.external_id).toBe('66f1a2b3c4d5e6f7a8b9c0d1');
    expect(row.client_id).toBe('mission-123');
    expect(row.publisher_id).toBe('5f5931496c7ea514150a818f');
    expect(row.publisher_name).toBe('JeVeuxAider.gouv.fr');
  });

  it('garde le lien de candidature tracké tel quel', () => {
    expect(ok(base).application_url).toBe(base.applicationUrl);
  });

  it('choisit le lieu le plus proche de la MEL parmi addresses[]', () => {
    const row = ok(base);
    expect(row.city).toBe('Lille');
    expect(row.postal_code).toBe('59800');
    expect(row.lat).toBe(50.63);
    expect(row.lng).toBe(3.09);
  });

  it('retombe sur les champs legacy sans addresses[]', () => {
    const row = ok({ ...base, addresses: undefined, city: 'Roubaix', postalCode: '59100', location: { lat: 50.69, lon: 3.17 } });
    expect(row.city).toBe('Roubaix');
    expect(row.lng).toBe(3.17);
  });

  it('lit duration en heures, les dates en ISO, places, organisation, logo, domaine et activités', () => {
    const row = ok(base);
    expect(row.duration_minutes).toBe(180);
    expect(row.starts_at).toBe('2026-10-03T07:00:00.000Z');
    expect(row.source_updated_at).toBe('2026-09-20T09:00:00.000Z');
    expect(row.places).toBe(8);
    expect(row.organization_name).toBe('Banque Alimentaire du Nord');
    expect(row.organization_logo_url).toBe('https://cdn.example.org/logo.png');
    expect(row.domain).toBe('solidarite-insertion');
    expect(row.activities).toEqual(['distribution', 'logistique']);
    expect(row.category).toBe('aide_alimentaire');
    expect(row.description).toBe('Aider à la préparation des colis.');
    expect(row.image_url).toBeNull();
    expect(row.source_illustration_url).toBe('https://cdn.example.org/domain.jpg');
  });

  it('sans duration, déduit la durée d’une plage courte mais pas d’une période longue', () => {
    expect(ok({ ...base, duration: null }).duration_minutes).toBe(180);
    expect(ok({ ...base, duration: null, endAt: '2026-12-31T10:00:00.000Z' }).duration_minutes).toBeNull();
  });

  it('écarte avec un motif : supprimée, non acceptée, 100 % à distance, volontariat, indemnisée, expirée, sans lien', () => {
    const reason = (patch: object) => {
      const r = mapApiEngagementMission({ ...base, ...patch }, { now: NOW });
      return r.ok ? 'ok' : r.reason;
    };
    expect(reason({ deleted: true })).toBe('deleted');
    expect(reason({ deletedAt: '2026-09-10T00:00:00Z' })).toBe('deleted');
    expect(reason({ statusCode: 'PENDING' })).toBe('not_accepted');
    expect(reason({ remote: 'full' })).toBe('remote_full');
    expect(reason({ type: 'volontariat_service_civique' })).toBe('type_excluded');
    expect(reason({ compensationAmount: 600 })).toBe('compensated');
    expect(reason({ endAt: '2026-09-01T00:00:00Z' })).toBe('expired');
    expect(reason({ applicationUrl: 'http://insecure.example.org' })).toBe('missing_application_url');
    expect(reason({ _id: undefined, id: undefined })).toBe('invalid');
    expect(mapApiEngagementMission(null).ok).toBe(false);
  });

  it('dérive l’URL d’impression du lien tracké', () => {
    expect(impressionUrlFromApplicationUrl(base.applicationUrl)).toBe(
      'https://api.api-engagement.beta.gouv.fr/r/impression/66f1a2b3c4d5e6f7a8b9c0d1/65aa00000000000000000001',
    );
    expect(impressionUrlFromApplicationUrl('https://www.jeveuxaider.gouv.fr/missions/1')).toBeNull();
  });

  it('catégorise par mots-clés puis par domaine officiel', () => {
    expect(categorize('culture-loisirs', 'Bénévole festival de musique', null)).toBe('evenementiel');
    expect(categorize('environnement', 'Nettoyage des berges', null)).toBe('environnement');
    expect(categorize('inconnu', 'Mission', null)).toBe('autre');
  });

  it('nettoie le HTML', () => {
    expect(stripHtml('<p>a</p><p>b</p>')).toBe('a\nb');
    expect(stripHtml('')).toBeNull();
  });
});
