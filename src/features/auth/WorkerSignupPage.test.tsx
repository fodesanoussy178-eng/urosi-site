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

  it('inscrit le participant avec l’essentiel : prénom, nom ou initiale, email, mot de passe, ville', async () => {
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
    await user.type(screen.getByLabelText('Ville'), 'Lille');
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
    expect(await screen.findByText('Compte créé !')).toBeInTheDocument();
  });

  it('refuse un formulaire incomplet sans appeler le serveur', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <WorkerSignupPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Prénom'), 'Léa');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(authService.signUp).not.toHaveBeenCalled();
  });

  it('transmet les centres d’intérêt facultatifs, sans aucun document demandé', async () => {
    const user = userEvent.setup();
    vi.mocked(authService.signUp).mockResolvedValue({ session: null } as never);
    render(
      <MemoryRouter>
        <WorkerSignupPage />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(/IBAN|pièce d'identité|SIRET/i)).toBeNull();
    await user.type(screen.getByLabelText('Prénom'), 'Léa');
    await user.type(screen.getByLabelText('Nom'), 'M');
    await user.type(screen.getByLabelText('Email'), 'lea@exemple.fr');
    await user.type(screen.getByLabelText('Mot de passe'), 'secret123');
    await user.type(screen.getByLabelText('Ville'), 'Roubaix');
    await user.click(screen.getByRole('button', { name: 'Aide alimentaire' }));
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    await waitFor(() =>
      expect(authService.signUp).toHaveBeenCalledWith({
        email: 'lea@exemple.fr',
        password: 'secret123',
        fullName: 'Léa M',
        role: 'worker',
        city: 'Roubaix',
        interests: ['aide_alimentaire'],
      }),
    );
  });
});
