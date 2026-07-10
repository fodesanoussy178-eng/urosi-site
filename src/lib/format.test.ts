import { describe, expect, it } from 'vitest';
import { formatEuros, formatHours } from './format';

describe('formatHours', () => {
  it('converts minutes to rounded hours', () => {
    expect(formatHours(120)).toBe('2 h');
    expect(formatHours(90)).toBe('1.5 h');
    expect(formatHours(100)).toBe('1.7 h');
  });
});

describe('formatEuros', () => {
  it('converts cents to a euro amount with two decimals', () => {
    expect(formatEuros(6800)).toBe('68.00 EUR');
    expect(formatEuros(150)).toBe('1.50 EUR');
  });
});
