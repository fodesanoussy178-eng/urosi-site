import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FeedMission } from '@/features/missions/solidarityMissions';
import { ParticipantApp } from './ParticipantApp';
import * as participantService from './participantService';
import * as missionsModule from '@/features/missions/solidarityMissions';

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { id: 'user-1', user_metadata: {} } },
    profile: { id: 'user-1', full_name: 'Léa Martin', public_first_name: null, city: 'Lille', skills: [], interests: [], avatar_url: null, bio: null },
    refreshProfile: vi.fn(),
  }),
}));
vi.mock('@/components/ui/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/features/missions/ratingsService', () => ({ fetchPendingRatingRequests: vi.fn().mockResolvedValue([]), rate: vi.fn() }));
vi.mock('@/features/missions/applicationsService', () => ({ applyToMission: vi.fn().mockResolvedValue(undefined), updateApplicationStatus: vi.fn() }));
vi.mock('./participantService', () => ({
  fetchMyExternalApplications: vi.fn().mockResolvedValue([]),
  fetchParticipantApplications: vi.fn().mockResolvedValue([]),
  fetchMyRatings: vi.fn().mockResolvedValue([]),
  recordExternalApplication: vi.fn(),
  declareExternalApplication: vi.fn(),
  removeAvatar: vi.fn(),
  saveInterests: vi.fn(),
  uploadAvatar: vi.fn(),
}));
vi.mock('@/features/missions/solidarityMissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/missions/solidarityMissions')>();
  return { ...actual, fetchSolidarityFeed: vi.fn() };
});

const externalMission: FeedMission = {
  key: 'external:em-1',
  id: 'em-1',
  kind: 'external_solidarity_mission',
  source: 'api_engagement',
  title: 'Distribution de colis alimentaires',
  description: 'Préparer et distribuer des colis.',
  organization: { id: null, name: 'Banque Alimentaire', logoUrl: null, verified: false },
  imageUrl: null,
  illustrationUrl: null,
  category: 'aide_alimentaire',
  city: 'Lille',
  address: null,
  coords: null,
  date: '2026-10-03',
  startTime: '09:00',
  endTime: '12:00',
  scheduleText: null,
  durationMinutes: 180,
  places: 8,
  applicationUrl: 'https://api.api-engagement.beta.gouv.fr/r/66f1a2b3c4d5e6f7a8b9c0d1/65aa00000000000000000001',
  partnerName: 'JeVeuxAider.gouv.fr',
  impressionUrl: 'https://api.api-engagement.beta.gouv.fr/r/impression/66f1a2b3c4d5e6f7a8b9c0d1/65aa00000000000000000001',
  isShort: true,
};

describe('ParticipantApp — phase 0', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(missionsModule.fetchSolidarityFeed).mockResolvedValue([externalMission]);
  });

  it('affiche la navigation Accueil / Missions / Favoris / Profil, sans aucun montant', async () => {
    render(<ParticipantApp />);
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent?.replace(/^\W+/, ''))).toEqual(['Accueil', 'Missions', 'Favoris', 'Profil']);
    await screen.findByText('Distribution de colis alimentaires');
    expect(document.body.textContent).not.toMatch(/€|wallet|banque de|iban|stripe|travailleur/i);
  });

  it('enregistre la candidature externe AVANT de rediriger vers le site partenaire', async () => {
    const user = userEvent.setup();
    const fakeWindow = { opener: {}, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window);
    vi.mocked(participantService.recordExternalApplication).mockImplementation(async () => {
      // Au moment de l'enregistrement, la redirection n'a pas encore eu lieu.
      expect(fakeWindow.location.href).toBe('');
    });

    render(<ParticipantApp />);
    await user.click(await screen.findByRole('button', { name: 'Voir la mission Distribution de colis alimentaires' }));
    const dialog = screen.getByRole('dialog', { name: /Distribution de colis alimentaires/ });
    expect(within(dialog).getByText(/Tu continueras ta candidature sur le site partenaire \(JeVeuxAider\.gouv\.fr\)/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Accepter$/ })).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Candidater ↗' }));

    await waitFor(() => expect(participantService.recordExternalApplication).toHaveBeenCalledWith('user-1', 'em-1', 'api_engagement'));
    await waitFor(() => expect(fakeWindow.location.href).toBe('https://api.api-engagement.beta.gouv.fr/r/66f1a2b3c4d5e6f7a8b9c0d1/65aa00000000000000000001'));
    expect(fakeWindow.opener).toBeNull();
    open.mockRestore();
  });

  it('ne redirige pas si l’enregistrement échoue', async () => {
    const user = userEvent.setup();
    const fakeWindow = { opener: {}, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window);
    vi.mocked(participantService.recordExternalApplication).mockRejectedValue(new Error('réseau'));

    render(<ParticipantApp />);
    await user.click(await screen.findByRole('button', { name: 'Voir la mission Distribution de colis alimentaires' }));
    await user.click(screen.getByRole('button', { name: 'Candidater ↗' }));

    await waitFor(() => expect(fakeWindow.close).toHaveBeenCalled());
    expect(fakeWindow.location.href).toBe('');
    open.mockRestore();
  });
});
