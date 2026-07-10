import { T } from '@/components/ui/theme';
import { formatEuros } from '@/lib/format';
import type { PricingBreakdown } from '@/types/database.types';

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

// Detail de la remuneration intelligente : base + majorations appliquees.
// Affiche cote Worker (transparence totale) et en apercu cote Structure.
export function PricingDetails({ breakdown, compact = false }: { breakdown: PricingBreakdown; compact?: boolean }) {
  if (!breakdown || !Array.isArray(breakdown.adjustments) || breakdown.adjustments.length === 0) return null;

  return (
    <div style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 10, padding: compact ? '9px 11px' : '11px 13px', marginBottom: compact ? 8 : 12 }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: T.cyan, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        ⚡ Rémunération boostée
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: compact ? 10.5 : 11.5, color: T.sub, padding: '2px 0' }}>
        <span>Base</span>
        <span>{euros(breakdown.base_cents)}</span>
      </div>
      {breakdown.adjustments.map((a) => (
        <div key={a.rule_id + a.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: compact ? 10.5 : 11.5, color: a.amount_cents >= 0 ? T.green : T.red, padding: '2px 0' }}>
          <span>{a.label}</span>
          <span>
            {a.amount_cents >= 0 ? '+' : ''}
            {euros(a.amount_cents)}
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: compact ? 11.5 : 13, fontWeight: 900, color: T.text, borderTop: `1px solid ${T.cb}`, marginTop: 5, paddingTop: 5 }}>
        <span>Total</span>
        <span>{euros(breakdown.total_cents)}</span>
      </div>
    </div>
  );
}
