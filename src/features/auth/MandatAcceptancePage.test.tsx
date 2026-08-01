import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MandatAcceptancePage } from './MandatAcceptancePage';
import { useAuth } from './AuthContext';
import * as mandatService from './mandatService';
import type { Profile } from '@/features/profile/profileService';

vi.mock('./AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('./mandatService', () => ({
  acceptMandat: vi.fn(),
}));

const refreshMandat = vi.fn();
const signOut = vi.fn();

function mockAuth(role: Profile['role']) {
  vi.mocked(useAuth).mockReturnValue({
    session: null,
    profile: { role } as Profile,
    loading: false,
    profileMissing: false,
    profileError: null,
    mandatAccepted: false,
    mandatError: null,
    refreshProfile: vi.fn(),
    refreshMandat,
    signOut,
  });
}

describe('MandatAcceptancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables submission until the mandate checkbox is checked', async () => {
    mockAuth('worker');
    render(<MandatAcceptancePage />);

    expect(screen.getByRole('button', { name: 'Accepter et continuer' })).toBeDisabled();
    await userEvent.setup().click(screen.getByLabelText("J'accepte le mandat"));
    expect(screen.getByRole('button', { name: 'Accepter et continuer' })).toBeEnabled();
  });

  it('records the mandate for the worker role and refreshes the gate', async () => {
    mockAuth('worker');
    vi.mocked(mandatService.acceptMandat).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<MandatAcceptancePage />);

    await user.click(screen.getByLabelText("J'accepte le mandat"));
    await user.click(screen.getByRole('button', { name: 'Accepter et continuer' }));

    expect(mandatService.acceptMandat).toHaveBeenCalledWith('worker');
    expect(refreshMandat).toHaveBeenCalled();
  });

  it('records the mandate with the structure_admin role, not "structure"', async () => {
    mockAuth('structure_admin');
    vi.mocked(mandatService.acceptMandat).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<MandatAcceptancePage />);

    await user.click(screen.getByLabelText("J'accepte le mandat"));
    await user.click(screen.getByRole('button', { name: 'Accepter et continuer' }));

    expect(mandatService.acceptMandat).toHaveBeenCalledWith('structure_admin');
  });

  it('shows the service error and lets the user leave via sign-out', async () => {
    mockAuth('worker');
    vi.mocked(mandatService.acceptMandat).mockRejectedValue(new Error('Une erreur métier claire.'));
    const user = userEvent.setup();
    render(<MandatAcceptancePage />);

    await user.click(screen.getByLabelText("J'accepte le mandat"));
    await user.click(screen.getByRole('button', { name: 'Accepter et continuer' }));

    expect(await screen.findByText('Une erreur métier claire.')).toBeInTheDocument();
    expect(refreshMandat).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(signOut).toHaveBeenCalled();
  });
});
