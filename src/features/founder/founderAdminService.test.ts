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
});
