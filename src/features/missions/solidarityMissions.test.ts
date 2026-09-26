import { describe, expect, it } from 'vitest';
import { features } from '@/lib/features';
import { fromExternalMission, fromNativeMission, isVisibleKind, partnerHost, sortFeed, type ExternalMission } from './solidarityMissions';
import type { MissionWithStructure } from './missionsService';

function external(overrides: Partial<ExternalMission> = {}): ExternalMission {
  return {
    id: 'ext-1',
    source: 'api_engagement',
    external_id: 'abc',
    title: 'Distribution de colis alimentaires',
    description: 'Aider à préparer les colis.',
    organization_name: 'Banque Alimentaire',
    organization_logo_url: null,
    image_url: null,
    source_illustration_url: 'https://cdn.example.org/domain.png',
    category: 'aide_alimentaire',
    city: 'Lille',
    postal_code: '59000',
    address: 'Fives',
    lat: 50.63,
    lng: 3.09,
    starts_at: '2026-10-03T07:00:00Z',
    ends_at: '2026-10-03T10:00:00Z',
    schedule_text: null,
    duration_minutes: 180,
    places: 8,
    application_url: 'https://www.jeveuxaider.gouv.fr/missions/123',
    source_url: null,
    is_active: true,
    raw: null,
    imported_at: '2026-09-20T00:00:00Z',
    updated_at: '2026-09-20T00:00:00Z',
    ...overrides,
  };
}

function native(overrides: Partial<MissionWithStructure> = {}): MissionWithStructure {
  return {
    id: 'm-1',
    structure_id: 's-1',
    title: 'Accueil du public',
    detail: null,
    city: 'Roubaix',
    address: null,
    location: null,
    lat: null,
    lng: null,
    scheduled_date: '2026-10-10',
    start_time: '14:00:00',
    end_time: '17:00:00',
    duration_minutes: 180,
    is_solidaire: true,
    mission_category: 'distribution',
    places: 2,
    positions: 2,
    structure: { name: 'Asso', trade_name: null, logo_url: null, siret: null, is_ess: true, is_association: true, about: null, verification_status: 'verified', founder_bypass: false, address: null, postal_code: null, city: null },
    ...overrides,
  } as MissionWithStructure;
}

describe('modèle unifié des missions', () => {
  it('convertit une mission externe avec horaires Europe/Paris, badge court et illustration de la source', () => {
    const m = fromExternalMission(external());
    expect(m.kind).toBe('external_solidarity_mission');
    expect(m.key).toBe('external:ext-1');
    expect(m.date).toBe('2026-10-03');
    expect(m.startTime).toBe('09:00');
    expect(m.endTime).toBe('12:00');
    expect(m.isShort).toBe(true);
    expect(m.illustrationUrl).toBe('https://cdn.example.org/domain.png');
    expect(m.applicationUrl).toContain('jeveuxaider');
  });

  it('distingue mission solidaire UROSI et mission rémunérée, et rattache les anciennes catégories', () => {
    expect(fromNativeMission(native()).kind).toBe('urosi_solidarity_mission');
    expect(fromNativeMission(native()).category).toBe('aide_alimentaire');
    expect(fromNativeMission(native({ is_solidaire: false })).kind).toBe('paid_mission');
    expect(fromNativeMission(native()).organization.verified).toBe(true);
  });

  it('masque toute mission rémunérée tant que la couche rémunérée est en sommeil', () => {
    expect(features.paidLayer).toBe(false);
    expect(isVisibleKind('paid_mission')).toBe(false);
    expect(isVisibleKind('external_solidarity_mission')).toBe(true);
    expect(isVisibleKind('urosi_solidarity_mission')).toBe(true);
    expect(isVisibleKind('paid_mission', true)).toBe(true);
  });

  it('trie par distance quand la position est connue, sinon par date', () => {
    const near = fromExternalMission(external({ id: 'near', lat: 50.63, lng: 3.06, starts_at: '2026-12-01T10:00:00Z' }));
    const far = fromExternalMission(external({ id: 'far', lat: 50.72, lng: 3.16, starts_at: '2026-10-01T10:00:00Z' }));
    expect(sortFeed([far, near], { lat: 50.6292, lng: 3.0573 }).map((m) => m.id)).toEqual(['near', 'far']);
    expect(sortFeed([near, far], null).map((m) => m.id)).toEqual(['far', 'near']);
  });

  it('extrait le site partenaire de l’URL de candidature', () => {
    expect(partnerHost('https://www.jeveuxaider.gouv.fr/missions/1')).toBe('jeveuxaider.gouv.fr');
    expect(partnerHost('pas une url')).toBeNull();
  });
});
