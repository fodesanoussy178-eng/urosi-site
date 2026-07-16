import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { FounderLabPanel } from './FounderLabPanel';

vi.mock('../founderAdminService', () => ({
  founderAdminApi: {
    labStatus: vi.fn().mockResolvedValue({ environment: 'production', enabled: false, scenarios: [] }),
    createLabScenario: vi.fn(),
  },
}));

describe('FounderLabPanel local test accounts', () => {
  beforeEach(() => localStorage.clear());

  it('creates a local structure test account that opens in the demo', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FounderLabPanel /></MemoryRouter>);

    await screen.findByText('Comptes de test locaux');
    await user.type(screen.getByLabelText('Nom du compte test'), 'Restaurant République Test');
    await user.click(screen.getByRole('button', { name: 'Créer une structure test' }));

    expect(screen.getByText('Restaurant République Test')).toBeInTheDocument();
    expect(screen.getByText('Structure test · ce navigateur')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ouvrir' })).toHaveAttribute('href', expect.stringContaining('/demo?role=structure&labAccount='));
  });
});
