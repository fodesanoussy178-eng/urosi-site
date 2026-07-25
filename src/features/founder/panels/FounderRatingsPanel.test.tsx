import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FounderRatingsPanel } from './FounderRatingsPanel';
import { founderAdminApi, type FounderRating } from '../founderAdminService';

vi.mock('../founderAdminService', () => ({
  founderAdminApi: {
    ratings: vi.fn(),
    ratingSubjectStats: vi.fn(),
    moderateRating: vi.fn(),
  },
}));

const pendingRating: FounderRating = {
  id: 'rating-1',
  direction: 'worker_to_structure',
  score: 4,
  comment: 'Super équipe, bon accueil',
  created_at: '2026-07-25T07:00:00.000Z',
  is_hidden: false,
  is_cancelled: false,
  is_flagged: false,
  test_force_visible: false,
  moderation_reason: null,
  moderated_at: null,
  moderated_by_name: null,
  mission_id: 'mission-1',
  mission_title: 'Renfort du midi',
  author_name: 'Jean Dupont',
  structure_id: 'structure-1',
  structure_name: 'Bistrot Central',
  worker_id: 'worker-1',
  worker_name: 'Jean Dupont',
  is_publicly_visible: false,
  scheduled_publish_at: '2026-07-25T13:00:00.000Z',
};

const hiddenRating: FounderRating = {
  ...pendingRating,
  id: 'rating-2',
  is_hidden: true,
  is_publicly_visible: false,
  moderation_reason: 'Commentaire injurieux',
  moderated_at: '2026-07-25T08:00:00.000Z',
  moderated_by_name: 'Fondateur',
};

describe('FounderRatingsPanel', () => {
  beforeEach(() => {
    vi.mocked(founderAdminApi.ratings).mockReset().mockResolvedValue([pendingRating]);
    vi.mocked(founderAdminApi.ratingSubjectStats).mockReset();
    vi.mocked(founderAdminApi.moderateRating).mockReset();
    vi.spyOn(window, 'prompt').mockReset();
  });

  it('affiche la note, le commentaire, l’auteur, la mission, la date et le statut public/masqué', async () => {
    render(<FounderRatingsPanel />);

    expect(await screen.findByText(/Super équipe, bon accueil/)).toBeInTheDocument();
    expect(screen.getByText(/Renfort du midi/)).toBeInTheDocument();
    expect(screen.getByText(/Jean Dupont/)).toBeInTheDocument();
    expect(screen.getByText('En attente')).toBeInTheDocument();
    expect(screen.getByText(/Publication prévue le/)).toBeInTheDocument();
  });

  it('montre le motif, le modérateur et la date de modération pour une note masquée', async () => {
    vi.mocked(founderAdminApi.ratings).mockResolvedValue([hiddenRating]);
    render(<FounderRatingsPanel />);

    expect(await screen.findByText('Masquée')).toBeInTheDocument();
    expect(screen.getByText(/Commentaire injurieux/)).toBeInTheDocument();
    expect(screen.getByText(/Fondateur/)).toBeInTheDocument();
  });

  it('n’envoie jamais la modération sans motif renseigné', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('   ');
    render(<FounderRatingsPanel />);

    fireEvent.click(await screen.findByText('Masquer'));

    await waitFor(() => expect(window.prompt).toHaveBeenCalled());
    expect(founderAdminApi.moderateRating).not.toHaveBeenCalled();
  });

  it('envoie l’action de modération avec le motif exact puis recharge la liste', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Signalé par un autre utilisateur');
    vi.mocked(founderAdminApi.moderateRating).mockResolvedValue({} as never);
    render(<FounderRatingsPanel />);

    fireEvent.click(await screen.findByText('Masquer'));

    await waitFor(() =>
      expect(founderAdminApi.moderateRating).toHaveBeenCalledWith('rating-1', 'hide', 'Signalé par un autre utilisateur'),
    );
    expect(founderAdminApi.ratings).toHaveBeenCalledTimes(2);
  });

  it('recharge avec les filtres direction/statut sélectionnés', async () => {
    render(<FounderRatingsPanel />);
    await screen.findByText(/Renfort du midi/);

    fireEvent.change(screen.getByDisplayValue('Les deux sens'), { target: { value: 'structure_to_worker' } });
    fireEvent.change(screen.getByDisplayValue('Toutes les notes'), { target: { value: 'hidden' } });

    await waitFor(() =>
      expect(founderAdminApi.ratings).toHaveBeenLastCalledWith('structure_to_worker', 'hidden'),
    );
  });

  it('recalcule la moyenne interne en temps réel à la demande', async () => {
    vi.mocked(founderAdminApi.ratingSubjectStats).mockResolvedValue({
      average: 4.2,
      count: 5,
      hidden_count: 1,
      flagged_count: 0,
      cancelled_count: 0,
    });
    render(<FounderRatingsPanel />);

    fireEvent.click(await screen.findByText('Moyenne interne (temps réel)'));

    expect(await screen.findByText(/Moyenne interne : 4.2\/5 sur 5 note\(s\)/)).toBeInTheDocument();
    expect(founderAdminApi.ratingSubjectStats).toHaveBeenCalledWith('worker_to_structure', 'structure-1');
  });

  it("propose de forcer l'affichage test pour une note encore en attente, avec motif obligatoire", async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Verification visuelle avant mise en prod');
    vi.mocked(founderAdminApi.moderateRating).mockResolvedValue({} as never);
    render(<FounderRatingsPanel />);

    fireEvent.click(await screen.findByText("Forcer l'affichage test"));

    await waitFor(() =>
      expect(founderAdminApi.moderateRating).toHaveBeenCalledWith(
        'rating-1',
        'force_test_preview',
        'Verification visuelle avant mise en prod',
      ),
    );
  });

  it("n'offre jamais de forcer l'affichage d'une note déjà publique ou annulée", async () => {
    vi.mocked(founderAdminApi.ratings).mockResolvedValue([
      { ...pendingRating, is_publicly_visible: true },
    ]);
    render(<FounderRatingsPanel />);
    await screen.findByText(/Renfort du midi/);

    expect(screen.queryByText("Forcer l'affichage test")).not.toBeInTheDocument();
  });

  it("affiche un badge test/staging et permet de réinitialiser le test une fois forcé", async () => {
    vi.mocked(founderAdminApi.ratings).mockResolvedValue([
      { ...pendingRating, test_force_visible: true, moderation_reason: 'Verification visuelle avant mise en prod', moderated_by_name: 'Fondateur' },
    ]);
    vi.spyOn(window, 'prompt').mockReturnValue('Fin de la verification');
    vi.mocked(founderAdminApi.moderateRating).mockResolvedValue({} as never);
    render(<FounderRatingsPanel />);

    expect(await screen.findByText(/AFFICHAGE FORCÉ/)).toBeInTheDocument();
    expect(screen.queryByText("Forcer l'affichage test")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Réinitialiser le test'));

    await waitFor(() =>
      expect(founderAdminApi.moderateRating).toHaveBeenCalledWith('rating-1', 'unforce_test_preview', 'Fin de la verification'),
    );
  });
});
