import { describe, expect, it, vi } from 'vitest';
import { features } from '@/lib/features';

// Aucune requête réseau : les deux sources « ne répondent jamais ».
vi.mock('@/lib/supabase', () => {
  const never = () => new Promise(() => undefined);
  const builder: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'order', 'limit']) builder[k] = () => builder;
  builder.then = (resolve: unknown, reject: unknown) => never().then(resolve as never, reject as never);
  return { supabase: { from: () => builder } };
});
import { fetchSolidarityFeedResult, fromExternalMission, fromNativeMission, impressionUrlFor, isVisibleKind, partnerHost, partnerLabel, sortFeed, type ExternalMission } from './solidarityMissions';
import type { MissionWithStructure } from './missionsService';
import { externalMissionRow } from '@/test/fixtures';

function external(overrides: Partial<ExternalMission> = {}): ExternalMission {
  return externalMissionRow(overrides);
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
    expect(m.domainLogoUrl).toBe('https://cdn.example.org/domain.png');
    expect(m.imageUrl).toBeNull();
    expect(m.applicationUrl).toContain('/r/66f1a2b3c4d5e6f7a8b9c0d1/');
    expect(m.partnerName).toBe('JeVeuxAider.gouv.fr');
    expect(m.impressionUrl).toBe('https://api.api-engagement.beta.gouv.fr/r/impression/66f1a2b3c4d5e6f7a8b9c0d1/65aa00000000000000000001');
  });

  it('ne présente comme photo que l’image retenue par l’agent avec des droits connus', () => {
    expect(fromExternalMission(external({ image_url: 'https://cdn.example.org/p.jpg', image_source: 'partner_mission_image', image_rights_status: 'source_provided' }))).toMatchObject({
      imageUrl: 'https://cdn.example.org/p.jpg',
      imageLevel: 'partner_mission_image',
    });
    expect(fromExternalMission(external({ image_url: 'https://cdn.example.org/p.jpg', image_source: 'authorized_image', image_rights_status: 'unknown' })).imageUrl).toBeNull();
    expect(fromExternalMission(external({ image_url: 'https://cdn.example.org/logo.png', image_source: 'organization_logo', image_rights_status: 'source_provided' })).imageUrl).toBeNull();
    expect(fromExternalMission(external({ domain_logo_url: 'https://cdn.example.org/d2.png' })).domainLogoUrl).toBe('https://cdn.example.org/d2.png');
  });

  it('rattache la photo principale d’une mission native', () => {
    expect(fromNativeMission(native(), 'https://x.supabase.co/storage/v1/object/public/mission-images/a/b/c.jpg')).toMatchObject({ imageLevel: 'native_photo' });
    expect(fromNativeMission(native())).toMatchObject({ imageUrl: null, imageLevel: null });
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

  it('n’affiche jamais le domaine technique de tracking comme site partenaire', () => {
    expect(partnerLabel({ partnerName: null, applicationUrl: 'https://api.api-engagement.beta.gouv.fr/r/a/b' })).toBeNull();
    expect(partnerLabel({ partnerName: 'Benenova', applicationUrl: 'https://api.api-engagement.beta.gouv.fr/r/a/b' })).toBe('Benenova');
    expect(impressionUrlFor('https://www.jeveuxaider.gouv.fr/missions/1')).toBeNull();
  });

  it('une mission native n’a ni lien tracké ni impression', () => {
    const m = fromNativeMission(native());
    expect(m.impressionUrl).toBeNull();
    expect(m.applicationUrl).toBeNull();
  });
});

describe('chargement du fil', () => {
  it('ne reste jamais bloqué : une source qui ne répond pas est traitée comme vide', async () => {
    vi.useFakeTimers();
    const pending = fetchSolidarityFeedResult(50);
    await vi.advanceTimersByTimeAsync(60);
    const result = await pending;
    vi.useRealTimers();
    expect(result.missions).toEqual([]);
    expect(result.unavailable).toBe(true);
  });
});
