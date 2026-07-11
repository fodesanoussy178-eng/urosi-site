import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { WorkerSignupPage } from './WorkerSignupPage';
import * as authService from './authService';

vi.mock('./authService', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendConfirmationEmail: vi.fn(),
  isUnconfirmedEmailError: () => false,
}));

describe('WorkerSignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ouvre avec des champs vides et des placeholders neutres', () => {
    render(
      <MemoryRouter>
        <WorkerSignupPage />
      </MemoryRouter>,
    );
    const prenom = screen.getByLabelText('Prénom') as HTMLInputElement;
    expect(prenom.value).toBe('');
    expect(prenom.placeholder).toBe('Prénom');
    expect((screen.getByLabelText('Ville') as HTMLInputElement).placeholder).toBe('Ville');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('');
  });

  it('exige la confirmation du mot de passe et les CGU puis inscrit le travailleur', async () => {
    const user = userEvent.setup();
    vi.mocked(authService.signUp).mockResolvedValue({ session: null } as never);
    render(
      <MemoryRouter>
        <WorkerSignupPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Prénom'), 'Camille');
    await user.type(screen.getByLabelText('Nom'), 'Durand');
    await user.type(screen.getByLabelText('Email'), 'camille@exemple.fr');
    await user.type(screen.getByLabelText('Mot de passe'), 'secret123');
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'secret123');
    await user.type(screen.getByLabelText('Ville'), 'Lille');

    // CGU non cochées : bouton désactivé
    expect(screen.getByRole('button', { name: /Remplis tes infos|Créer mon compte/ })).toBeDisabled();
    await user.click(screen.getByLabelText("J'accepte les conditions d'utilisation"));
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    await waitFor(() =>
      expect(authService.signUp).toHaveBeenCalledWith({
        email: 'camille@exemple.fr',
        password: 'secret123',
        fullName: 'Camille Durand',
        role: 'worker',
        city: 'Lille',
      }),
    );
  });
});
