import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

    expect(screen.getByText('✓ Structure vérifiée · identité et SIRET confirmés (démo)')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('missions publiées')).toBeInTheDocument();
    expect(screen.getByText('94 %')).toBeInTheDocument();
    expect(screen.getByText('★ 4,8')).toBeInTheDocument();
    expect(screen.getByText('21 avis')).toBeInTheDocument();
  });

  it('offers a QR and dynamic PIN simulation from the structure demo', async () => {
    const user = userEvent.setup();
    renderStructure();

    await user.click(screen.getByRole('button', { name: 'Tester le QR + PIN' }));

    expect(screen.getByRole('dialog', { name: 'Simulation QR et PIN' })).toBeInTheDocument();
    expect(screen.getByText('482731')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tester côté travailleur sans scanner ↗' })).toHaveAttribute('href', expect.stringContaining('scan=worker-pin'));
  });

  it('validates the simulated worker arrival with the displayed PIN', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/demo?scan=worker-pin&step=start&mission=pm1&title=Renfort+service+midi&structure=Burger+Nord']}>
        <DemoExperience />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('PIN temporaire de simulation'), '482731');
    await user.click(screen.getByRole('button', { name: 'Démarrer maintenant' }));

    expect(screen.getByText('✓ Arrivée horodatée · confirmé en direct côté structure')).toBeInTheDocument();

    // Le même QR sert ensuite à la fin de mission, sans changer de page.
    await user.click(screen.getByRole('button', { name: 'Simuler la fin de mission maintenant' }));
    expect(screen.getByText('Terminer la mission')).toBeInTheDocument();
    await user.type(screen.getByLabelText('PIN temporaire de simulation'), '482731');
    await user.click(screen.getByRole('button', { name: 'Terminer maintenant' }));
    expect(screen.getByText('✓ Départ horodaté · confirmé en direct côté structure')).toBeInTheDocument();
  });

  it('opens a quick mission detail from the feed card, with the full structure page behind a button', async () => {
    const user = userEvent.setup();
    renderWorker();

    await user.click(screen.getByText('Renfort service midi'));
    const sheet = screen.getByRole('dialog', { name: 'Détail de la mission Renfort service midi' });
    expect(sheet).toBeInTheDocument();
    expect(screen.getByText('Rush du midi, aide comptoir, salle propre et équipe déjà briefée.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Voir le profil' }));
    expect(screen.queryByRole('dialog', { name: 'Détail de la mission Renfort service midi' })).not.toBeInTheDocument();
  });

  it('shows the structure only the two most recent missions by default, and never the earnings', async () => {
    const user = userEvent.setup();
    localStorage.setItem('urosi_founder_demo_shared_v1', JSON.stringify({
      candidates: [{ id: 'demo-worker-m1', missionId: 'm1', name: 'Alex Démo', city: 'Lille', note: 4.7, here: 1, history: [['x', 'y']], status: 'pending' }],
    }));
    renderStructure();

    await user.click(screen.getByRole('button', { name: /Candidats/ }));
    await user.click(screen.getByText('Alex Démo'));

    expect(screen.getByText('Historique vérifié (CV vivant)')).toBeInTheDocument();
    // Sans autorisation du travailleur : seulement les 2 plus récentes.
    expect(screen.getByText('Renfort service midi')).toBeInTheDocument();
    expect(screen.getByText('Inventaire magasin')).toBeInTheDocument();
    expect(screen.queryByText('Montage festival')).not.toBeInTheDocument();
    // Les revenus ne sont jamais visibles côté structure.
    expect(screen.queryByText(/64 €/)).not.toBeInTheDocument();
    expect(screen.queryByText(/42 €/)).not.toBeInTheDocument();
  });

  it('shows the full mission history when the worker authorises it, still without earnings', async () => {
    const user = userEvent.setup();
    localStorage.setItem('urosi_founder_demo_shared_v1', JSON.stringify({
      workerCvShareAll: true,
      candidates: [{ id: 'demo-worker-m1', missionId: 'm1', name: 'Alex Démo', city: 'Lille', note: 4.7, here: 1, history: [['x', 'y']], status: 'pending' }],
    }));
    renderStructure();

    await user.click(screen.getByRole('button', { name: /Candidats/ }));
    await user.click(screen.getByText('Alex Démo'));

    expect(screen.getByText('Montage festival')).toBeInTheDocument();
    expect(screen.getByText('Service en salle')).toBeInTheDocument();
    expect(screen.queryByText(/91 €/)).not.toBeInTheDocument();
  });

  it('shows the worker cancellation to the structure with the waiting-list proposal', () => {
    localStorage.setItem('urosi_founder_demo_shared_v1', JSON.stringify({
      workerCancellations: [{ missionId: 'm1', missionTitle: 'Renfort service midi', workerName: 'Alex Démo' }],
    }));
    renderStructure();

    expect(screen.getByText('Alex Démo a annulé sa participation')).toBeInTheDocument();
    expect(screen.getByText(/file d'attente|republie automatiquement/)).toBeInTheDocument();
  });

  it('derives the scan step from the simulation state: a started mission proposes the end', async () => {
    const user = userEvent.setup();
    const first = render(
      <MemoryRouter initialEntries={['/demo?scan=worker-pin&step=start&mission=pm1&title=Renfort&structure=Burger+Nord']}>
        <DemoExperience />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('PIN temporaire de simulation'), '482731');
    await user.click(screen.getByRole('button', { name: 'Démarrer maintenant' }));
    first.unmount();

    // Nouveau scan du même QR (paramètre d'URL toujours step=start) :
    // la page doit proposer la fin de mission.
    render(
      <MemoryRouter initialEntries={['/demo?scan=worker-pin&step=start&mission=pm1&title=Renfort&structure=Burger+Nord']}>
        <DemoExperience />
      </MemoryRouter>,
    );
    expect(screen.getByText('Terminer la mission')).toBeInTheDocument();
  });

  it('allows several missions while limiting each mission to three days', async () => {
    const user = userEvent.setup();
    renderStructure();

    expect(screen.queryByText('MODE DÉMO')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Peupler le flux' })).not.toBeInTheDocument();
    expect(screen.getByText('Plusieurs missions possibles · 3 jours maximum par mission')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Publier une mission' }));
    const addDay = screen.getByRole('button', { name: /Ajouter un jour/ });
    await user.click(addDay);
    await user.click(addDay);

    const dates = screen.getAllByLabelText(/Date du jour/) as HTMLInputElement[];
    expect(new Set(dates.map((input) => input.value)).size).toBe(3);
    expect(addDay).toBeDisabled();
    expect(screen.getByText('Une mission dure 3 jours maximum.')).toBeInTheDocument();
  });

  it('moves the structure statistics to history after three seconds', () => {
    vi.useFakeTimers();
    renderStructure();

    expect(screen.getByLabelText('Statistiques de la structure')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByLabelText('Statistiques de la structure')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Historique' }));
    expect(screen.getByLabelText('Statistiques de la structure')).toBeInTheDocument();
    vi.useRealTimers();
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

  it('exposes stable targets for the step-by-step landing tutorial', () => {
    const { container } = renderWorker();

    expect(container.querySelector('[data-demo-tour="mission-card"]')).toBeInTheDocument();
    expect(container.querySelector('[data-demo-tour="mission-action"]')).toBeInTheDocument();
    expect(container.querySelector('[data-demo-tab="moi"]')).toHaveTextContent('Missions');
  });

  it('keeps the guided landing tutorial readable after the free preview expires', () => {
    localStorage.setItem('urosi_internal_demo_seconds_v1', '60');
    const { container } = render(
      <MemoryRouter initialEntries={['/demo?role=worker&embed=1&tour=1']}>
        <DemoExperience />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Fin de l’aperçu gratuit')).not.toBeInTheDocument();
    expect(container.querySelector('[data-demo-tour="mission-card"]')).toBeInTheDocument();
  });

  it('never darkens the embedded landing preview after the free preview expires', () => {
    localStorage.setItem('urosi_internal_demo_seconds_v1', '60');
    const { container } = render(
      <MemoryRouter initialEntries={['/demo?role=worker&embed=1']}>
        <DemoExperience />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Fin de l’aperçu gratuit')).not.toBeInTheDocument();
    expect(container.querySelector('[data-demo-tour="mission-card"]')).toBeInTheDocument();
  });

  it('keeps the internal navigation above content and the iPhone home indicator', () => {
    renderWorker();

    const navigation = screen.getByRole('navigation', { name: 'Navigation de la démo' });
    expect(navigation).toHaveStyle({ position: 'fixed', zIndex: '1000', isolation: 'isolate' });
    expect(navigation.style.padding).toContain('env(safe-area-inset-bottom)');
  });

  it('hides the structure photo gallery completely when no photo is available', async () => {
    const user = userEvent.setup();
    renderWorker();

    await user.click(screen.getByRole('button', { name: 'Burger Nord ›' }));
    expect(screen.queryByText('Photos du lieu')).not.toBeInTheDocument();
    expect(screen.queryByText(/Voir toutes les photos/)).not.toBeInTheDocument();
    expect(screen.getByText('À propos')).toBeInTheDocument();
  });

  it('keeps the structure profile concise and reveals reviews progressively', async () => {
    const user = userEvent.setup();
    renderWorker();

    await user.click(screen.getByRole('button', { name: 'Burger Nord ›' }));

    expect(screen.getByLabelText('En-tête du profil structure')).toHaveStyle({ height: '58px' });
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('missions réalisées')).toBeInTheDocument();
    expect(screen.getByText('94 %')).toBeInTheDocument();
    expect(screen.getByText('des missions réalisées')).toBeInTheDocument();
    expect(screen.getByText('(10 avis)')).toBeInTheDocument();
    expect(screen.queryByText('missions publiées')).not.toBeInTheDocument();
    expect(screen.getAllByText('Avis anonyme vérifié')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Voir les missions disponibles' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Voir 5 avis sur 10' }));
    expect(screen.getAllByText('Avis anonyme vérifié')).toHaveLength(5);
  });

  it('opens the anonymized reviews from the structure space', async () => {
    const user = userEvent.setup();
    renderStructure();

    await user.click(screen.getByRole('button', { name: 'Voir les avis reçus' }));

    expect(screen.getByRole('region', { name: 'Avis reçus par la structure' })).toBeInTheDocument();
    expect(screen.getAllByText('Avis anonyme vérifié')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Voir 5 avis sur 21' }));
    expect(screen.getAllByText('Avis anonyme vérifié')).toHaveLength(5);
  });

  it('shows a long local test structure name without truncating it', () => {
    localStorage.setItem('urosi_founder_local_lab_accounts_v1', JSON.stringify([{
      id: 'test-structure-long-name',
      name: 'Association Solidaire Métropole Européenne de Lille',
      role: 'structure',
      createdAt: new Date().toISOString(),
    }]));
    render(
      <MemoryRouter initialEntries={['/demo?role=structure&labAccount=test-structure-long-name']}>
        <DemoExperience />
      </MemoryRouter>,
    );

    expect(screen.getByText('Association Solidaire Métropole Européenne de Lille')).toBeInTheDocument();
  });

  it('makes the living CV and bank status immediately readable', async () => {
    const user = userEvent.setup();
    renderWorker();

    await user.click(screen.getByRole('button', { name: /Missions/ }));
    expect(screen.getByText('Disponible demain')).toBeInTheDocument();
    expect(screen.getByText('✓ Compte et identité vérifiés (démo)')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('Restauration · 2')).toBeInTheDocument();
    expect(screen.getByText('Événementiel · 7')).toBeInTheDocument();
    expect(screen.getByText('Logistique · 6')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Banque/ }));
    expect(screen.getByText('Historique des virements')).toBeInTheDocument();
    expect(screen.getByText('IBAN vérifié')).toBeInTheDocument();
    expect(screen.getByText('Carte d’identité vérifiée')).toBeInTheDocument();
    expect(screen.getByText('Compte vérifié')).toBeInTheDocument();

    expect(screen.getByText('182')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Masquer le solde' }));
    expect(screen.queryByText('182')).not.toBeInTheDocument();
    expect(screen.getAllByText('•••').length).toBeGreaterThan(1);
  });
});
