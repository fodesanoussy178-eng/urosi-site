import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StructureStatsSummary } from './StatsPanel';
import { fetchStructureStats } from '@/features/stats/statsService';

vi.mock('@/features/stats/statsService', () => ({
  fetchStructureStats: vi.fn(),
}));

describe('StructureStatsSummary', () => {
  beforeEach(() => {
    vi.mocked(fetchStructureStats).mockResolvedValue({
      missions_total: 12,
      missions_open: 2,
      applications_total: 13,
      applications_pending: 3,
      missions_completed: 9,
      unique_workers: 8,
      total_paid_cents: 0,
      total_commission_cents: 0,
      total_bonus_cents: 0,
      avg_rating: 4.8,
      ratings_count: 21,
    });
  });

  it('shows only values returned by Supabase and the real decision ratio', async () => {
    render(<StructureStatsSummary structureId="structure-1" acceptedCount={9} decidedCount={10} />);

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('90 %')).toBeInTheDocument();
    expect(screen.getByText('★ 4,8')).toBeInTheDocument();
    expect(screen.getByText('21 avis')).toBeInTheDocument();
  });
});
