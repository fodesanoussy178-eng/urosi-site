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

function renderWorker() {
  localStorage.setItem(DEMO_FOUNDER_ACCESS_KEY, '1');
  return render(
    <MemoryRouter initialEntries={['/demo?role=worker']}>
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

    await user.click(screen.getByRole('button', { name: 'Actions pour Préparation mariage' }));
    await user.click(screen.getByRole('button', { name: 'Modifier le prix' }));
    const amount = screen.getByLabelText('Prix par personne');
    await user.clear(amount);
    await user.type(amount, '99');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(screen.getByText('99 €')).toBeInTheDocument();
  });

  it('deletes a mission from both demo sides after confirmation', async () => {
    const user = userEvent.setup();
    renderStructure();

    await user.click(screen.getByRole('button', { name: 'Actions pour Préparation mariage' }));
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    await user.click(screen.getByRole('button', { name: 'Supprimer définitivement' }));

    expect(screen.queryByRole('button', { name: 'Actions pour Préparation mariage' })).not.toBeInTheDocument();
    const state = JSON.parse(localStorage.getItem('urosi_founder_demo_shared_v1') || '{}') as { deletedMissionIds?: string[] };
    expect(state.deletedMissionIds).toContain('pm3');
  });

  it('never offers permanent deletion after a candidate is linked', async () => {
    const user = userEvent.setup();
    renderStructure();

    await user.click(screen.getByRole('button', { name: 'Actions pour Renfort service midi' }));

    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler la mission' })).toBeInTheDocument();
  });

  it('archives without deleting and keeps the mission restorable in history', async () => {
    const user = userEvent.setup();
    renderStructure();

    await user.click(screen.getByRole('button', { name: 'Actions pour Préparation mariage' }));
    await user.click(screen.getByRole('button', { name: 'Archiver' }));
    await user.click(screen.getByRole('button', { name: 'Archiver' }));
    await user.click(screen.getByRole('button', { name: 'Historique' }));

    expect(screen.getByText('Missions archivées · 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restaurer' })).toBeInTheDocument();
  });

  it('shows the structure activity statistics at a glance', () => {
    renderStructure();

    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('missions publiées')).toBeInTheDocument();
    expect(screen.getByText('94 %')).toBeInTheDocument();
    expect(screen.getByText('★ 4,8')).toBeInTheDocument();
    expect(screen.getByText('21 avis')).toBeInTheDocument();
  });

  it('uses varied structures, jobs and ratings in the worker feed', () => {
    renderWorker();

    expect(screen.getByText('Décathlon Lille ›')).toBeInTheDocument();
    expect(screen.getByText('Festival de Lille ›')).toBeInTheDocument();
    expect(screen.getByText('Mairie de Lille ›')).toBeInTheDocument();
    expect(screen.getByText('📦 Inventaire magasin')).toBeInTheDocument();
    expect(screen.getByText('🎥 Assistant tournage')).toBeInTheDocument();
    expect(screen.getByText(/4,3 · 41 avis/)).toBeInTheDocument();
    expect(screen.getByText(/5,0 · 16 avis/)).toBeInTheDocument();
  });

  it('makes the living CV and bank status immediately readable', async () => {
    const user = userEvent.setup();
    renderWorker();

    await user.click(screen.getByRole('button', { name: /Missions/ }));
    expect(screen.getByText('Disponible demain')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('Restauration')).toBeInTheDocument();
    expect(screen.getByText('Événementiel')).toBeInTheDocument();
    expect(screen.getByText('Logistique')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Banque/ }));
    expect(screen.getByText('Historique des virements')).toBeInTheDocument();
    expect(screen.getByText('IBAN vérifié')).toBeInTheDocument();
    expect(screen.getByText('Carte d’identité vérifiée')).toBeInTheDocument();
    expect(screen.getByText('Compte vérifié')).toBeInTheDocument();
  });
});
