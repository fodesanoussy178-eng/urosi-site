import { beforeEach, describe, expect, it } from 'vitest';
import type { FeedMission } from '@/features/missions/solidarityMissions';
import { dayLabel, distanceLabel, durationLabel, hoursLabel } from './format';
import { displayName, externalItem, nativeItem, type ExternalRow, type NativeRow } from './journeyService';
import { missionsInCity, missionsNearMe, nearestKnownCommune, sameCity } from './location';
import { answerLocalClick, localClicks, pendingLocalQuestions, rememberClick, visitorId } from './visitor';

function mission(id: string, city: string, coords: { lat: number; lng: number } | null, date = '2026-10-04'): FeedMission {
  return {
    key: `external:${id}`, id, kind: 'external_solidarity_mission', source: 'api_engagement', title: `Mission ${id}`, description: null,
    organization: { id: null, name: 'Asso', logoUrl: null, verified: false }, imageUrl: null, imageLevel: null, domainLogoUrl: null,
    category: 'solidarite', city, address: null, coords, date, startTime: null, endTime: null, scheduleText: null, durationMinutes: 180,
    places: null, applicationUrl: 'https://example.org', partnerName: null, impressionUrl: null, isShort: true,
  };
}

const LILLE_CENTER = { lat: 50.6292, lng: 3.0573 };

describe('comportement 1 — je vois des missions près de moi', () => {
  const lille = mission('lille', 'Lille', { lat: 50.64, lng: 3.07 });
  // Commune voisine, mais plus proche du point que la mission de Lille.
  const lambersart = mission('lambersart', 'Lambersart', { lat: 50.631, lng: 3.055 });
  const roubaix = mission('roubaix', 'Roubaix', { lat: 50.69, lng: 3.17 });
  const unknown = mission('sans-coords', 'Lille', null, '2026-10-01');

  it('« Près de moi » trie par proximité réelle, commune voisine comprise', () => {
    const list = missionsNearMe([roubaix, lille, unknown, lambersart], LILLE_CENTER).map((x) => x.mission.id);
    expect(list).toEqual(['lambersart', 'lille', 'roubaix', 'sans-coords']);
  });

  it('« Voir dans ma ville » ne montre que la commune détectée, jamais au-delà', () => {
    const list = missionsInCity([roubaix, lille, unknown, lambersart], 'Lille', LILLE_CENTER).map((x) => x.mission.id);
    expect(list).toEqual(['sans-coords', 'lille']);
    expect(missionsInCity([lambersart], 'lille', LILLE_CENTER)).toHaveLength(0);
  });

  it('reconnaît une commune malgré accents et tirets, et trouve la plus proche', () => {
    expect(sameCity('Villeneuve-d’Ascq', 'villeneuve d ascq')).toBe(true);
    expect(sameCity('Marcq-en-Barœul', 'MARCQ EN BAROEUL')).toBe(true);
    expect(sameCity('Lille', 'Lomme')).toBe(false);
    expect(nearestKnownCommune({ lat: 50.692, lng: 3.176 })).toBe('Roubaix');
  });

  it('affiche distance, jour et durée comme « 800 m », « Samedi · 3 h »', () => {
    const now = new Date('2026-09-28T10:00:00'); // lundi
    expect(distanceLabel(0.8)).toBe('800 m');
    expect(distanceLabel(2.14)).toBe('2,1 km');
    expect(dayLabel('2026-09-28', now)).toBe('Aujourd’hui');
    expect(dayLabel('2026-09-29', now)).toBe('Demain');
    expect(dayLabel('2026-10-03', now)).toBe('Samedi');
    expect(dayLabel('2026-10-20', now)).toMatch(/^Mar\. 20 oct/);
    expect(durationLabel(180)).toBe('3 h');
    expect(durationLabel(90)).toBe('1 h 30');
    expect(hoursLabel('09:00:00', '12:30:00')).toBe('9h – 12h30');
  });
});

describe('comportements 3 à 5 — candidature, déclaration, confirmation', () => {
  const base: ExternalRow = {
    external_mission_id: 'm1', status: 'external_application_started', clicked_at: '2026-09-20T10:00:00Z',
    mission_date: '2026-09-27', organization_name: 'Banque Alimentaire', declared_minutes: null,
    mission: { title: 'Distribution alimentaire', organization_name: 'Banque Alimentaire', starts_at: '2026-09-27T07:00:00Z', duration_minutes: 180 },
  };

  it('demande « Alors, ta mission ? » seulement après la date', () => {
    expect(externalItem(base, '2026-09-27').state).toBe('applied');
    expect(externalItem(base, '2026-09-28').state).toBe('ask');
    // Sans date : une semaine après le clic.
    const undated = { ...base, mission_date: null, mission: { ...base.mission!, starts_at: null } };
    expect(externalItem(undated, '2026-09-27').state).toBe('applied');
    expect(externalItem(undated, '2026-09-28').state).toBe('ask');
  });

  it('une déclaration n’est jamais une vérification ; seule la structure rend la pastille verte', () => {
    expect(externalItem({ ...base, status: 'completed_declared' }, '2026-10-01').state).toBe('declared');
    expect(externalItem({ ...base, status: 'verified_completed' }, '2026-10-01').state).toBe('verified');
    expect(externalItem({ ...base, status: 'not_done_declared' }, '2026-10-01').state).toBe('closed');
    expect(externalItem({ ...base, status: 'not_confirmed' }, '2026-10-01').state).toBe('closed');
    // L'ancienne vérification par l'équipe UROSI n'est pas une confirmation de la structure.
    expect(externalItem({ ...base, status: 'verified' }, '2026-10-01').state).toBe('declared');
  });

  it('mission UROSI : question seulement si la candidature avait été retenue', () => {
    const row: NativeRow = { mission_id: 'n1', status: 'accepted', cv_status: null, participant_declared_completed: null, mission: { title: 'Tri', scheduled_date: '2026-09-27', duration_minutes: 120, structure: { name: 'Asso', trade_name: null } } };
    expect(nativeItem(row, '2026-09-28')?.state).toBe('ask');
    expect(nativeItem({ ...row, status: 'pending' }, '2026-09-28')).toBeNull();
    expect(nativeItem({ ...row, participant_declared_completed: true }, '2026-09-28')?.state).toBe('declared');
    expect(nativeItem({ ...row, participant_declared_completed: true, cv_status: 'verified', attendance_status: 'end_confirmed' }, '2026-09-28')?.state).toBe('verified');
    expect(nativeItem({ ...row, participant_declared_completed: true, cv_status: 'verified', attendance_status: 'not_started' }, '2026-09-28')?.state).toBe('declared');
  });

  it('affiche « Hugo M. »', () => {
    expect(displayName('Hugo Martin')).toBe('Hugo M.');
    expect(displayName('Hugo')).toBe('Hugo');
    expect(displayName('Hugo Jean Martin', 'Hugo')).toBe('Hugo M.');
  });
});

describe('visiteur sans compte', () => {
  beforeEach(() => localStorage.clear());

  it('garde un identifiant stable et ses candidatures sur l’appareil', () => {
    const id = visitorId();
    expect(visitorId()).toBe(id);
    rememberClick({ key: 'external:m1', missionId: 'm1', title: 'Distribution', organization: 'Banque Alimentaire', askAfter: '2026-09-27', clickedAt: '2026-09-20T10:00:00Z' });
    expect(pendingLocalQuestions('2026-09-27')).toHaveLength(0);
    expect(pendingLocalQuestions('2026-09-28')).toHaveLength(1);
    answerLocalClick('external:m1', 'not_went');
    expect(pendingLocalQuestions('2026-09-28')).toHaveLength(0);
    expect(localClicks()[0]?.answer).toBe('not_went');
  });
});
