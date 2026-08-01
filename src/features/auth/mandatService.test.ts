import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn(() => ({ insert: insertMock })));
const getUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: rpcMock, from: fromMock, auth: { getUser: getUserMock } },
}));

import { acceptMandat, fetchHasActiveMandat, MANDAT_VERSION } from './mandatService';

describe('mandatService', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    insertMock.mockReset();
    fromMock.mockClear();
    getUserMock.mockReset();
  });

  describe('fetchHasActiveMandat', () => {
    it('calls the guard RPC and coerces the result to a boolean', async () => {
      rpcMock.mockResolvedValue({ data: true, error: null });
      await expect(fetchHasActiveMandat()).resolves.toBe(true);
      expect(rpcMock).toHaveBeenCalledWith('has_active_mandat');
    });

    it('throws the Supabase error rather than swallowing it', async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
      await expect(fetchHasActiveMandat()).rejects.toMatchObject({ message: 'permission denied' });
    });
  });

  describe('acceptMandat', () => {
    it('inserts the current user id, the exact role, and the reference version', async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      insertMock.mockResolvedValue({ error: null });

      await acceptMandat('structure_admin');

      expect(fromMock).toHaveBeenCalledWith('mandat_acceptances');
      expect(insertMock).toHaveBeenCalledWith({
        user_id: 'user-1',
        role: 'structure_admin',
        version: MANDAT_VERSION,
      });
    });

    it('never sends the role as "structure" — the CHECK constraint only allows structure_admin', async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      insertMock.mockResolvedValue({ error: null });

      await acceptMandat('structure_admin');

      expect(insertMock).toHaveBeenCalledTimes(1);
      const [payload] = insertMock.mock.calls[0] as [{ role: string }];
      expect(payload.role).not.toBe('structure');
      expect(payload.role).toBe('structure_admin');
    });

    it('refuses to insert without an authenticated user', async () => {
      getUserMock.mockResolvedValue({ data: { user: null }, error: null });
      await expect(acceptMandat('worker')).rejects.toThrow('Authentification requise');
      expect(insertMock).not.toHaveBeenCalled();
    });

    it('surfaces the RLS/insert error from Supabase', async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      insertMock.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } });
      await expect(acceptMandat('worker')).rejects.toMatchObject({ message: 'new row violates row-level security policy' });
    });
  });
});
