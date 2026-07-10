import { describe, expect, it } from 'vitest';
import { distanceKm, formatDistance, geocodeMelCity } from './geo';

describe('geocodeMelCity', () => {
  it('trouve une commune MEL dans une adresse libre', () => {
    const coords = geocodeMelCity('12 Rue de Béthune, Lille');
    expect(coords).not.toBeNull();
    expect(coords!.lat).toBeCloseTo(50.6292, 3);
  });

  it('normalise accents et tirets', () => {
    expect(geocodeMelCity("Villeneuve-d'Ascq")).not.toBeNull();
    expect(geocodeMelCity('MARCQ-EN-BAROEUL')).not.toBeNull();
  });

  it('prefere la commune la plus specifique', () => {
    const lys = geocodeMelCity('Lys-lez-Lannoy');
    expect(lys).toEqual(geocodeMelCity('lyslezlannoy'));
  });

  it('retourne null hors MEL', () => {
    expect(geocodeMelCity('Paris 11e')).toBeNull();
    expect(geocodeMelCity('')).toBeNull();
  });
});

describe('distanceKm', () => {
  it('Lille -> Roubaix ≈ 10-12 km', () => {
    const lille = geocodeMelCity('Lille')!;
    const roubaix = geocodeMelCity('Roubaix')!;
    const d = distanceKm(lille, roubaix);
    expect(d).toBeGreaterThan(8);
    expect(d).toBeLessThan(14);
  });

  it('distance nulle au meme point', () => {
    const p = { lat: 50.63, lng: 3.06 };
    expect(distanceKm(p, p)).toBe(0);
  });
});

describe('formatDistance', () => {
  it('affiche en metres sous 1 km', () => {
    expect(formatDistance(0.4)).toBe('400 m');
  });
  it('affiche en km avec virgule', () => {
    expect(formatDistance(10.25)).toBe('10,3 km');
  });
});
