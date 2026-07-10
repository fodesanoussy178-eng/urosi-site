import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { WorkerSignupPage } from './WorkerSignupPage';
import * as authService from './authService';

vi.mock('./authService', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

describe('WorkerSignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signs up a worker with full name, city and role', async () => {
    const user = userEvent.setup();
    vi.mocked(authService.signUp).mockResolvedValue({ session: null } as never);
    render(
      <MemoryRouter>
        <WorkerSignupPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Prénom'), 'Fodé');
    await user.type(screen.getByLabelText('Nom'), 'Diallo');
    await user.type(screen.getByLabelText('Email'), 'fode@email.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'secret123');
    await user.type(screen.getByLabelText('Ville'), 'Tourcoing');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    await waitFor(() =>
      expect(authService.signUp).toHaveBeenCalledWith({
        email: 'fode@email.com',
        password: 'secret123',
        fullName: 'Fodé Diallo',
        role: 'worker',
        city: 'Tourcoing',
        phone: undefined,
      }),
    );
  });
});
