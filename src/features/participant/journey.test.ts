import { describe, expect, it } from 'vitest';
import { buildExperiences, externalHeadline, externalTimeline, nativeHeadline, nativeTimeline, summarize } from './journey';
import type { ExternalApplicationWithMission, ParticipantApplication, ParticipantRating } from './participantService';

const TODAY = '2026-10-05';

function ext(overrides: Partial<ExternalApplicationWithMission> = {}): ExternalApplicationWithMission {
  return {
    id: 'ea-1',
    user_id: 'u-1',
    external_mission_id: 'em-1',
    source: 'api_engagement',
    clicked_at: '2026-09-25T14:32:00Z',
    status: 'external_application_started',
    status_updated_at: '2026-09-25T14:32:00Z',
    accepted_declared_at: null,
    completed_declared_at: null,
    declared_minutes: null,
    verified_at: null,
    verified_by: null,
    verification_note: null,
    mission: {
      id: 'em-1',
      source: 'api_engagement',
      external_id: 'x',
      title: 'Distribution de colis',
      description: null,
      organization_name: 'Banque Alimentaire',
      organization_logo_url: null,
      image_url: null,
      source_illustration_url: null,
      category: 'aide_alimentaire',
      city: 'Lille',
      postal_code: null,
      address: null,
      lat: null,
      lng: null,
      starts_at: '2026-10-10T07:00:00Z',
      ends_at: '2026-10-10T10:00:00Z',
      schedule_text: null,
      duration_minutes: 180,
      places: null,
      application_url: 'https://www.jeveuxaider.gouv.fr/m/1',
      source_url: null,
      is_active: true,
      raw: null,
      imported_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    },
    ...overrides,
  };
}

function nat(overrides: Partial<ParticipantApplication> = {}): ParticipantApplication {
  return {
    id: 'a-1',
    mission_id: 'm-1',
    status: 'pending',
    attendance_status: 'not_started',
    cv_status: null,
    cv_status_reason: null,
    cv_verified_at: null,
    actual_start_at: null,
    actual_end_at: null,
    conversation_status: 'closed',
    created_at: '2026-09-20T10:00:00Z',
    mission: {
      id: 'm-1',
      title: 'Soutien scolaire',
      city: 'Roubaix',
      address: null,
      scheduled_date: '2026-09-30',
      start_time: '14:00:00',
      end_time: '17:00:00',
      duration_minutes: 180,
      mission_category: 'soutien_scolaire',
      is_solidaire: true,
      structure_id: 's-1',
      structure: { name: 'Coup de Pouce', trade_name: null, logo_url: null },
    },
    ...overrides,
  };
}

const stateOf = (steps: ReturnType<typeof externalTimeline>, key: string) => steps.find((s) => s.key === key)?.state;

describe('suivi d’une candidature externe', () => {
  it('juste après la redirection : candidature externe faite, en attente, rien d’inventé', () => {
    const steps = externalTimeline(ext(), TODAY);
    expect(stateOf(steps, 'external')).toBe('done');
    expect(stateOf(steps, 'waiting')).toBe('current');
    expect(stateOf(steps, 'accepted')).toBe('upcoming');
    expect(stateOf(steps, 'verified')).toBe('upcoming');
    expect(externalHeadline(ext(), TODAY)).toEqual({ label: 'En attente', tone: 'waiting' });
  });

  it('une acceptation déclarée est marquée comme déclaration, jamais comme vérification', () => {
    const steps = externalTimeline(ext({ status: 'accepted_declared', accepted_declared_at: '2026-09-27T09:00:00Z' }), TODAY);
    const accepted = steps.find((s) => s.key === 'accepted');
    expect(accepted?.state).toBe('done');
    expect(accepted?.declared).toBe(true);
    expect(accepted?.label).toContain('déclarée');
    expect(stateOf(steps, 'planned')).toBe('current');
    expect(stateOf(steps, 'verified')).toBe('upcoming');
  });

  it('une mission réalisée déclarée attend toujours la vérification UROSI', () => {
    const steps = externalTimeline(ext({ status: 'completed_declared' }), TODAY);
    expect(stateOf(steps, 'completed')).toBe('done');
    expect(steps.find((s) => s.key === 'completed')?.declared).toBe(true);
    expect(stateOf(steps, 'verified')).toBe('current');
  });

  it('une candidature retirée arrête la suite du parcours', () => {
    const steps = externalTimeline(ext({ status: 'withdrawn' }), TODAY);
    expect(stateOf(steps, 'waiting')).toBe('stopped');
    expect(stateOf(steps, 'accepted')).toBe('stopped');
  });
});

describe('suivi d’une candidature UROSI', () => {
  it('acceptée par la structure = confirmation réelle (non déclarée)', () => {
    const steps = nativeTimeline(nat({ status: 'accepted' }), '2026-09-25');
    const accepted = steps.find((s) => s.key === 'accepted');
    expect(accepted?.state).toBe('done');
    expect(accepted?.declared).toBe(false);
    expect(stateOf(steps, 'planned')).toBe('current');
    expect(nativeHeadline(nat({ status: 'accepted' }))).toEqual({ label: 'Acceptée', tone: 'success' });
  });

  it('participation confirmée puis expérience vérifiée', () => {
    const ended = nat({ status: 'payment_pending', attendance_status: 'end_confirmed', cv_status: 'pending_verification' });
    expect(stateOf(nativeTimeline(ended, TODAY), 'completed')).toBe('done');
    expect(stateOf(nativeTimeline(ended, TODAY), 'verified')).toBe('current');
    const verified = { ...ended, cv_status: 'verified' as const };
    expect(stateOf(nativeTimeline(verified, TODAY), 'verified')).toBe('done');
    expect(nativeHeadline(verified).tone).toBe('verified');
  });

  it('non retenue : pas de suite', () => {
    const steps = nativeTimeline(nat({ status: 'rejected' }), TODAY);
    expect(steps.find((s) => s.key === 'waiting')?.label).toBe('Candidature non retenue');
    expect(stateOf(steps, 'accepted')).toBe('stopped');
  });
});

describe('parcours', () => {
  const ratings: ParticipantRating[] = [
    { application_id: 'a-2', structure_id: 's-1', score: 5, comment: 'Très investie !', direction: 'structure_to_worker', status: 'published', created_at: '2026-10-01T00:00:00Z' },
    { application_id: 'a-3', structure_id: 's-1', score: 2, comment: 'pas encore publié', direction: 'structure_to_worker', status: 'pending', created_at: '2026-10-01T00:00:00Z' },
  ];

  it('ne compte dans les chiffres que les expériences vérifiées, les déclarations à part', () => {
    const experiences = buildExperiences(
      [
        nat({ id: 'a-2', status: 'completed', attendance_status: 'end_confirmed', cv_status: 'verified', actual_start_at: '2026-09-30T12:00:00Z', actual_end_at: '2026-09-30T14:30:00Z' }),
        nat({ id: 'a-4', status: 'pending' }),
      ],
      [ext({ status: 'completed_declared', declared_minutes: 120 }), ext({ id: 'ea-2', status: 'external_application_started' })],
      ratings,
    );
    expect(experiences).toHaveLength(2);
    const summary = summarize(experiences, ratings);
    expect(summary.missions).toBe(1);
    expect(summary.minutes).toBe(150);
    expect(summary.structures).toBe(1);
    expect(summary.declaredPending).toBe(1);
    expect(summary.reviewsReceived).toBe(1);
    expect(summary.averageReceived).toBe(5);
    const verified = experiences.find((e) => e.verified);
    expect(verified?.structureComment).toBe('Très investie !');
    expect(verified?.skills.length).toBeGreaterThan(0);
  });

  it('une expérience externe vérifiée par UROSI compte comme vérifiée', () => {
    const experiences = buildExperiences([], [ext({ status: 'verified', declared_minutes: 90 })], []);
    expect(summarize(experiences, []).missions).toBe(1);
    expect(summarize(experiences, []).minutes).toBe(90);
  });
});
