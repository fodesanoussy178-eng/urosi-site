import { T } from '@/components/ui/theme';
import { formatEuros } from '@/lib/format';
import type { PriceSplitValues } from '@/features/pricing/priceSplit';

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

// Decomposition automatique du prix : remuneration, commission structure,
// cout total structure. Affichee a la publication et sur le detail mission.
export function PriceSplit({ values, side }: { values: PriceSplitValues; side: 'structure' | 'worker' }) {
  const row = (label: string, amount: string, color: string, bold = false) => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: bold ? 12.5 : 11.5, fontWeight: bold ? 900 : 500, color, padding: '3px 0' }}>
      <span>{label}</span>
      <span>{amount}</span>
    </div>
  );

  return (
    <div style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: T.cyan, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>
        Décomposition automatique
      </div>
      {row('Rémunération travailleur', euros(values.brutCents), T.text)}
      {side === 'structure' && row(`Commission UROSI structure`, `+${euros(values.commissionStructureCents)}`, T.sub)}
      {values.commissionWorkerCents > 0 && row(`Commission UROSI travailleur`, `−${euros(values.commissionWorkerCents)}`, T.sub)}
      {row('Montant perçu par le travailleur', euros(values.netWorkerCents), T.green, true)}
      {side === 'structure' && (
        <div style={{ borderTop: `1px solid ${T.cb}`, marginTop: 4, paddingTop: 4 }}>
          {row('Coût total structure', euros(values.totalStructureCents), T.text, true)}
        </div>
      )}
    </div>
  );
}
