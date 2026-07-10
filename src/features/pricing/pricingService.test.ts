import { describe, expect, it } from 'vitest';
import { RULE_KINDS, RULE_TEMPLATES, ruleParamsSummary } from './pricingService';

describe('ruleParamsSummary', () => {
  it('resume les jours de la semaine', () => {
    expect(ruleParamsSummary('day_of_week', { days: [6, 7] })).toBe('sam, dim');
  });

  it('resume une plage horaire', () => {
    expect(ruleParamsSummary('time_of_day', { from: '21:00', to: '06:00' })).toBe('21:00 → 06:00');
  });

  it('resume une duree minimale en heures', () => {
    expect(ruleParamsSummary('duration', { min_minutes: 240 })).toBe('dès 4 h');
  });

  it('resume distance et tension', () => {
    expect(ruleParamsSummary('distance', { min_km: 10 })).toBe('dès 10 km');
    expect(ruleParamsSummary('tension', { min_ratio: 2 })).toBe('ratio ≥ 2');
  });

  it('reste vide pour les regles sans parametres', () => {
    expect(ruleParamsSummary('holiday', {})).toBe('');
    expect(ruleParamsSummary('custom', {})).toBe('');
  });
});

describe('RULE_TEMPLATES', () => {
  it('chaque modele a un type connu et un ajustement non nul', () => {
    for (const t of RULE_TEMPLATES) {
      expect(Object.keys(RULE_KINDS)).toContain(t.kind);
      expect((t.adjust_pct ?? 0) !== 0 || (t.adjust_cents ?? 0) !== 0).toBe(true);
    }
  });

  it('couvre les criteres exiges (jour, ferie, horaire, duree, difficulte, urgence, distance, tension, bonus)', () => {
    const kinds = new Set(RULE_TEMPLATES.map((t) => t.kind));
    for (const k of ['day_of_week', 'holiday', 'time_of_day', 'duration', 'difficulty', 'urgency', 'distance', 'tension', 'custom']) {
      expect(kinds.has(k as never)).toBe(true);
    }
  });
});
