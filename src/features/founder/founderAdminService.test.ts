import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}));

import { founderAdminApi } from './founderAdminService';

describe('founderAdminApi', () => {
  beforeEach(() => rpcMock.mockReset());

  it('delegates dashboard reads to the protected RPC', async () => {
    rpcMock.mockResolvedValue({ data: { users: 4 }, error: null });
    await expect(founderAdminApi.dashboard()).resolves.toMatchObject({ users: 4 });
    expect(rpcMock).toHaveBeenCalledWith('founder_admin_dashboard', undefined);
  });

  it('sends account suspension data to the server-side action', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await founderAdminApi.setAccountStatus('profile-1', 'suspended', 'Signalements répétés', '2026-07-20T12:00:00Z');
    expect(rpcMock).toHaveBeenCalledWith('founder_admin_set_account_status', {
      p_profile_id: 'profile-1',
      p_status: 'suspended',
      p_reason: 'Signalements répétés',
      p_suspended_until: '2026-07-20T12:00:00Z',
    });
  });

  it('surfaces Supabase authorization errors', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Accès fondateur requis.' } });
    await expect(founderAdminApi.createLabScenario('user')).rejects.toThrow('Accès fondateur requis.');
  });

  it('lists ratings with direction/status/limit filters', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await founderAdminApi.ratings('worker_to_structure', 'hidden', 50);
    expect(rpcMock).toHaveBeenCalledWith('founder_ratings_list', {
      p_direction: 'worker_to_structure',
      p_status: 'hidden',
      p_limit: 50,
    });
  });

  it('defaults ratings filters to null when omitted', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await founderAdminApi.ratings();
    expect(rpcMock).toHaveBeenCalledWith('founder_ratings_list', {
      p_direction: null,
      p_status: null,
      p_limit: 200,
    });
  });

  it('fetches live internal rating stats for a subject', async () => {
    rpcMock.mockResolvedValue({ data: { average: 4.5, count: 2, hidden_count: 0, flagged_count: 0, cancelled_count: 0 }, error: null });
    await expect(founderAdminApi.ratingSubjectStats('structure_to_worker', 'worker-1')).resolves.toMatchObject({ count: 2 });
    expect(rpcMock).toHaveBeenCalledWith('founder_rating_subject_stats', {
      p_direction: 'structure_to_worker',
      p_subject_id: 'worker-1',
    });
  });

  it('sends moderation action with mandatory reason to the RPC', async () => {
    rpcMock.mockResolvedValue({ data: { id: 'rating-1', is_hidden: true }, error: null });
    await founderAdminApi.moderateRating('rating-1', 'hide', 'Commentaire injurieux');
    expect(rpcMock).toHaveBeenCalledWith('founder_moderate_rating', {
      p_rating_id: 'rating-1',
      p_action: 'hide',
      p_reason: 'Commentaire injurieux',
    });
  });

  it('surfaces moderation errors (e.g. missing reason)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Un motif est requis.' } });
    await expect(founderAdminApi.moderateRating('rating-1', 'hide', '')).rejects.toThrow('Un motif est requis.');
  });
});
