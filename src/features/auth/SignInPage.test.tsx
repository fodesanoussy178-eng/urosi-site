import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SignInPage } from './SignInPage';
import * as authService from './authService';

vi.mock('./authService', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
  claimFounderAccess: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendConfirmationEmail: vi.fn(),
  isUnconfirmedEmailError: vi.fn(() => false),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage(initialEntry = '/connexion') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SignInPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('SignInPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authService.signIn).mockReset().mockResolvedValue(undefined);
  });

  it('signs in with email and password', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'toi@email.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => expect(authService.signIn).toHaveBeenCalledWith({ email: 'toi@email.com', password: 'secret123' }));
  });

  it('shows the error message returned by the auth service', async () => {
    const user = userEvent.setup();
    vi.mocked(authService.signIn).mockRejectedValue(new Error('Invalid login credentials'));
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'toi@email.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument();
  });

  it('opens the founder area after a founder login request', async () => {
    const user = userEvent.setup();
    renderPage('/connexion?next=/fondateur/kyc');

    await user.type(screen.getByLabelText('Email'), 'fondateur@urosi.fr');
    await user.type(screen.getByLabelText('Mot de passe'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Accéder à l’espace fondateur' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/fondateur'));
  });
});
