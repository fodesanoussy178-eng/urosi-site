export interface PriceSplitValues {
  brutCents: number;
  commissionStructureCents: number;
  commissionWorkerCents: number;
  netWorkerCents: number;
  totalStructureCents: number;
}

// V1 : la remuneration du travailleur n'est pas amputee. La commission UROSI
// est ajoutee uniquement au cout de la structure.
export function splitPrice(brutCents: number, structurePct: number): PriceSplitValues {
  const commissionStructureCents = Math.round((brutCents * structurePct) / 100);
  return {
    brutCents,
    commissionStructureCents,
    commissionWorkerCents: 0,
    netWorkerCents: brutCents,
    totalStructureCents: brutCents + commissionStructureCents,
  };
}
