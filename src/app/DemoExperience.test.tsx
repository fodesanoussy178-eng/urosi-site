import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DemoExperience } from './DemoExperience';
import { DEMO_FOUNDER_ACCESS_KEY } from '@/lib/founder';

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ session: null }),
}));

function renderScan(step: 'start' | 'end') {
  return render(
    <MemoryRouter initialEntries={[`/demo?scan=founder&step=${step}&mission=m1&title=Renfort+service+midi&structure=Burger+Nord`]}>
      <DemoExperience />
    </MemoryRouter>,
  );
}

function renderStructure() {
  localStorage.setItem(DEMO_FOUNDER_ACCESS_KEY, '1');
  return render(
    <MemoryRouter initialEntries={['/demo?role=structure']}>
      <DemoExperience />
    </MemoryRouter>,
  );
}

describe('DemoExperience founder scan', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('asks for the founder code only before founder access is remembered', () => {
    renderScan('start');
    expect(screen.getByLabelText('Code fondateur de démonstration')).toBeInTheDocument();
  });

  it('simulates mission completion without asking for the founder code again', async () => {
    const user = userEvent.setup();
    localStorage.setItem(DEMO_FOUNDER_ACCESS_KEY, '1');
    renderScan('end');

    expect(screen.queryByLabelText('Code fondateur de démonstration')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Terminer la mission · simulation' }));

    expect(screen.getByText('✓ Fin de mission simulée confirmée')).toBeInTheDocument();
    const state = JSON.parse(localStorage.getItem('urosi_founder_demo_shared_v1') || '{}') as {
      completedMissionIds?: string[];
      workerUnreadWalletMissionIds?: string[];
    };
    expect(state.completedMissionIds).toContain('m1');
    expect(state.workerUnreadWalletMissionIds).toContain('m1');
  });

  it('updates a mission price from its management sheet', async () => {
    const user = userEvent.setup();
    renderStructure();

    await user.click(screen.getByRole('button', { name: /Renfort service midi/ }));
    const amount = screen.getByLabelText('Rémunération travailleur');
    await user.clear(amount);
    await user.type(amount, '99');
    await user.click(screen.getByRole('button', { name: 'Modifier le prix' }));

    expect(screen.getByRole('button', { name: /Renfort service midi.*99 €/ })).toBeInTheDocument();
  });

  it('deletes a mission from both demo sides after confirmation', async () => {
    const user = userEvent.setup();
    renderStructure();

    await user.click(screen.getByRole('button', { name: /Renfort service midi/ }));
    await user.click(screen.getByRole('button', { name: 'Supprimer la mission' }));
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect(screen.queryByRole('button', { name: /Renfort service midi/ })).not.toBeInTheDocument();
    const state = JSON.parse(localStorage.getItem('urosi_founder_demo_shared_v1') || '{}') as { deletedMissionIds?: string[] };
    expect(state.deletedMissionIds).toContain('m1');
  });
});
