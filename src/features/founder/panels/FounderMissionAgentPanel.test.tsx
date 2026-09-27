import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionAgentOverview } from '../missionAgentAdminService';

const overview: MissionAgentOverview = {
  schedule: null,
  next_run_at: null,
  last_run: {
    id: 'run-1', trigger: 'manual', status: 'not_configured', started_at: '2026-09-27T10:00:00Z', finished_at: '2026-09-27T10:00:01Z',
    fetched: 0, imported: 0, created_count: 0, updated_count: 0, unchanged_count: 0, reactivated_count: 0, skipped: 0, deactivated: 0,
    duplicates: 0, without_image: 0, images_found: 0, images_rejected: 0,
    sources_report: [{ source: 'api_engagement', name: 'API Engagement', status: 'not_configured', fetched: 0, created: 0, updated: 0, unchanged: 0, reactivated: 0, deactivated: 0, skipped: 0, images_found: 0, images_rejected: 0, message: "API_ENGAGEMENT_KEY n'est pas configurée" }],
    errors: [],
    error_message: "API Engagement : API_ENGAGEMENT_KEY n'est pas configurée",
  },
  runs: [],
  sources: [{ id: 'api_engagement', name: 'API Engagement', source_type: 'api', enabled: true, automated_access_allowed: true, mission_images_reusable: false, logos_reusable: true, reuse_basis: 'API publique', verified_at: '2026-09-27T09:00:00Z', active: 0, inactive: 0, last_checked_at: null }],
  catalog: { active: 0, duplicates: 2, without_image: 3, without_photo: 5, native_without_photo: 0, images_found: 1, images_rejected: 4, by_image_source: {} },
  rejected_images: [],
};

const fetchOverview = vi.fn(async () => overview);
const runNow = vi.fn(async () => ({ ...overview.last_run!, run_id: 'run-2' }));

vi.mock('../missionAgentAdminService', () => ({
  fetchMissionAgentOverview: () => fetchOverview(),
  runMissionAgentNow: () => runNow(),
  authorizeImageRights: vi.fn(),
}));

describe('Centre Fondateur — Agent Missions', () => {
  beforeEach(() => {
    fetchOverview.mockClear();
    runNow.mockClear();
  });

  it('affiche dernière et prochaine exécution, sources, doublons, images et relance', async () => {
    const { FounderMissionAgentPanel } = await import('./FounderMissionAgentPanel');
    render(<FounderMissionAgentPanel />);
    expect(await screen.findByText('Non planifiée')).toBeInTheDocument();
    expect(screen.getByText(/Non configuré/)).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.getByText('doublons masqués').previousSibling).toHaveTextContent('2');
    expect(screen.getByText('missions sans image (illustration)').previousSibling).toHaveTextContent('3');
    expect(screen.getByText('images refusées (droits inconnus)').previousSibling).toHaveTextContent('4');
    expect(screen.getByText(/Pas encore planifiée/)).toBeInTheDocument();
    expect(screen.getByText(/Clé absente/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Relancer maintenant/ }));
    await waitFor(() => expect(runNow).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toHaveTextContent(/Non configuré/);
    expect(fetchOverview).toHaveBeenCalledTimes(2);
  });
});
