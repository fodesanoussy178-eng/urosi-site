// Interrupteurs de phase. Phase 0 (missions solidaires) : tout est coupé par
// défaut. La couche rémunérée n'est pas supprimée, elle est mise en sommeil :
// la réactiver revient à passer VITE_FEATURE_PAID_LAYER=true, sans migration.
function flag(value: unknown): boolean {
  return value === 'true' || value === true;
}

export const features = {
  // Wallet, Stripe, mandat, déblocage, missions rémunérées, démo historique.
  paidLayer: flag(import.meta.env.VITE_FEATURE_PAID_LAYER),
  // Pointage QR arrivée / départ (phase 1, missions natives UROSI).
  qrAttendance: flag(import.meta.env.VITE_FEATURE_QR_ATTENDANCE),
} as const;
