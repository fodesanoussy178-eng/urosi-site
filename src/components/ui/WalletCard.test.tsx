import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletCard } from './WalletCard';
import { fetchWallet, fetchWalletFundSummary, fetchWalletTransactions } from '@/features/wallet/walletService';

vi.mock('@/features/wallet/walletService', () => ({
  fetchWallet: vi.fn(),
  fetchWalletFundSummary: vi.fn(),
  fetchWalletTransactions: vi.fn(),
  TX_KIND_LABELS: { earning: 'Mission payée' },
}));

describe('WalletCard worker privacy', () => {
  beforeEach(() => {
    vi.mocked(fetchWallet).mockResolvedValue({ id: 'wallet-1', balance_cents: 12345 } as never);
    vi.mocked(fetchWalletFundSummary).mockResolvedValue({ available_cents: 12345, pending_cents: 2500, blocked_cents: 0 });
    vi.mocked(fetchWalletTransactions).mockResolvedValue([
      { id: 'tx-1', kind: 'earning', amount_cents: 6400, fund_status: 'available', created_at: '2026-07-15T12:00:00Z', label: 'Mission terminée' },
    ] as never);
  });

  it('masks worker amounts by default and reveals them on request', async () => {
    const user = userEvent.setup();
    render(<WalletCard profileId="worker-1" mode="worker" />);

    expect(screen.getAllByText('•••').length).toBeGreaterThan(0);
    expect(screen.queryByText(/123[.,]45/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Afficher les montants' }));
    expect(await screen.findAllByText(/123[.,]45/)).not.toHaveLength(0);
    expect(await screen.findByText(/64[.,]00/)).toBeInTheDocument();
  });
});
