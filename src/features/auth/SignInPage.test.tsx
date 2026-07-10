import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SignInPage } from './SignInPage';
import * as authService from './authService';

vi.mock('./authService', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <SignInPage />
    </MemoryRouter>,
  );
}

describe('SignInPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
