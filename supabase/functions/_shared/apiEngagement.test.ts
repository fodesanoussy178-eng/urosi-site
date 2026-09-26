import { describe, expect, it } from 'vitest';
import { categorize, mapApiEngagementMission, stripHtml } from './apiEngagement';

const base = {
  _id: '65f0',
  title: 'Distribution de colis alimentaires',
  description: '<p>Aider à la <b>préparation</b>&nbsp;des colis.</p>',
  organizationName: 'Banque Alimentaire du Nord',
  organizationLogo: 'https://cdn.example.org/logo.png',
  domain: 'solidarite-insertion',
  domainLogo: 'https://cdn.example.org/domain.jpg',
  city: 'Lille',
  postalCode: '59000',
  location: { lat: 50.63, lon: 3.09 },
  startAt: '2026-10-03T07:00:00.000Z',
  endAt: '2026-10-03T10:00:00.000Z',
  places: 8,
  applicationUrl: 'https://www.jeveuxaider.gouv.fr/missions/1',
};

describe('import API Engagement', () => {
  it('convertit une mission complète', () => {
    const row = mapApiEngagementMission(base);
    expect(row).not.toBeNull();
    expect(row?.external_id).toBe('65f0');
    expect(row?.description).toBe('Aider à la préparation des colis.');
    expect(row?.category).toBe('aide_alimentaire');
    expect(row?.lng).toBe(3.09);
    expect(row?.duration_minutes).toBe(180);
    expect(row?.image_url).toBeNull();
    expect(row?.source_illustration_url).toBe('https://cdn.example.org/domain.jpg');
  });

  it('refuse une mission sans URL https de candidature, sans identifiant ou 100 % à distance', () => {
    expect(mapApiEngagementMission({ ...base, applicationUrl: 'http://insecure.example.org' })).toBeNull();
    expect(mapApiEngagementMission({ ...base, _id: undefined })).toBeNull();
    expect(mapApiEngagementMission({ ...base, remote: 'full' })).toBeNull();
    expect(mapApiEngagementMission(null)).toBeNull();
  });

  it('ne présente pas une longue période de disponibilité comme une durée', () => {
    const row = mapApiEngagementMission({ ...base, endAt: '2026-12-31T10:00:00.000Z' });
    expect(row?.duration_minutes).toBeNull();
  });

  it('catégorise par mots-clés puis par domaine', () => {
    expect(categorize('culture-loisirs', 'Bénévole festival de musique', null)).toBe('evenementiel');
    expect(categorize('environnement', 'Nettoyage des berges', null)).toBe('environnement');
    expect(categorize('inconnu', 'Mission', null)).toBe('autre');
  });

  it('nettoie le HTML', () => {
    expect(stripHtml('<p>a</p><p>b</p>')).toBe('a\nb');
    expect(stripHtml('')).toBeNull();
  });
});
