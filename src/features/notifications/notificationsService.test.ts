import { describe, expect, it } from 'vitest';
import { isVisibleInCurrentPhase, phaseWording } from './notificationsService';

describe('notifications en phase 0', () => {
  it('reformule le vocabulaire des anciens triggers', () => {
    expect(phaseWording('Mission terminée — « Tri » est marquée terminée. Pense à noter le travailleur.')).toBe(
      'Mission terminée — « Tri » est marquée terminée. Pense à noter le bénévole.',
    );
    expect(phaseWording('Nouvelle note sur ton CV vivant')).toBe('Nouvelle note sur ton parcours');
    expect(phaseWording('Mission terminee - note le travailleur')).toBe('Mission terminée - note le bénévole');
  });

  it('masque les notifications de la couche rémunérée', () => {
    expect(isVisibleInCurrentPhase({ kind: 'payment', title: 'Paiement reçu', body: '42 €' })).toBe(false);
    expect(isVisibleInCurrentPhase({ kind: 'application_accepted', title: 'Candidature acceptée', body: null })).toBe(true);
  });
});
