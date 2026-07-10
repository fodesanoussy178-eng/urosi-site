import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from './LandingPage';

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ session: null, profile: null, loading: false, refreshProfile: async () => undefined }),
}));

const fetchOpenMissions = vi.fn();
vi.mock('@/features/missions/missionsService', () => ({
  fetchOpenMissions: (...args: unknown[]) => fetchOpenMissions(...args),
}));

describe('LandingPage', () => {
  it("affiche le hero, le bouton Ouvrir l'app et les missions de démonstration quand la base est vide", async () => {
    fetchOpenMissions.mockResolvedValueOnce([]);
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/payées au juste prix/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ouvrir l'app/i })).toBeInTheDocument();
    // Base vide -> cartes de démonstration, clairement marquées
    expect(await screen.findByText(/missions de démonstration/i)).toBeInTheDocument();
    expect(screen.getByText('Renfort service du midi')).toBeInTheDocument();
    expect(screen.getAllByText('démo').length).toBeGreaterThan(0);
  });

  it('affiche les vraies missions Supabase quand il y en a', async () => {
    fetchOpenMissions.mockResolvedValueOnce([
      {
        id: 'm1',
        structure_id: 's1',
        title: 'Plonge du soir',
        detail: null,
        city: 'Lille',
        address: null,
        lat: null,
        lng: null,
        distance_km: null,
        scheduled_date: '2026-07-12',
        start_time: '21:00:00',
        duration_minutes: 240,
        sector: 'restauration',
        difficulty: 1,
        is_urgent: false,
        worker_rate_cents: 5250,
        base_rate_cents: 4200,
        pricing_breakdown: {
          base_cents: 4200,
          adjustments: [{ rule_id: 'r1', kind: 'time_of_day', label: 'Majoration nuit', amount_cents: 1050 }],
          total_cents: 5250,
        },
        is_solidaire: false,
        status: 'open',
        created_at: '',
        structure: { name: 'Brasserie Test', siret: '123', is_ess: false, about: null },
      },
    ]);
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Plonge du soir')).toBeInTheDocument();
    expect(screen.getByText('Brasserie Test')).toBeInTheDocument();
    expect(screen.getByText(/En ce moment sur UROSI/i)).toBeInTheDocument();
    // Horaire réel issu de l'annonce
    expect(screen.getByText(/21:00/)).toBeInTheDocument();
    expect(screen.queryByText('démo')).not.toBeInTheDocument();
  });
});
