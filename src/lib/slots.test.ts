import { describe, expect, it } from 'vitest';
import { areConsecutiveDays, spanDays, totalMinutes } from './slots';
import type { MissionSlot } from '@/types/database.types';

const slot = (date: string, start = '09:00', end = '12:00'): MissionSlot => ({ date, start, end });

describe('slots', () => {
  it('calcule les minutes de plusieurs creneaux', () => {
    expect(totalMinutes([slot('2026-07-13'), slot('2026-07-13', '14:00', '16:30')])).toBe(330);
  });

  it('valide uniquement les jours consecutifs', () => {
    expect(areConsecutiveDays([slot('2026-07-13'), slot('2026-07-14'), slot('2026-07-15')])).toBe(true);
    expect(spanDays([slot('2026-07-13'), slot('2026-07-15')])).toBe(3);
    expect(areConsecutiveDays([slot('2026-07-13'), slot('2026-07-15')])).toBe(false);
  });
});
