import { describe, expect, it } from 'vitest';
import { computeRatingVisibility, summarizeCountedRatings } from './ratingVisibility';

const NOW = new Date('2026-07-25T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('computeRatingVisibility', () => {
  it('garde la 1ère note invisible', () => {
    const results = computeRatingVisibility([{ id: 'a', score: 5, createdAt: minutesAgo(10) }], NOW);
    expect(results.map((r) => r.counted)).toEqual([false]);
    expect(summarizeCountedRatings(results)).toEqual({ average: null, count: 0 });
  });

  it('garde les 2 premières notes invisibles', () => {
    const results = computeRatingVisibility(
      [
        { id: 'a', score: 5, createdAt: minutesAgo(20) },
        { id: 'b', score: 3, createdAt: minutesAgo(10) },
      ],
      NOW,
    );
    expect(results.map((r) => r.counted)).toEqual([false, false]);
    expect(summarizeCountedRatings(results)).toEqual({ average: null, count: 0 });
  });

  it('la 3e note declenche l’affichage immediat des 3', () => {
    const results = computeRatingVisibility(
      [
        { id: 'a', score: 5, createdAt: minutesAgo(20) },
        { id: 'b', score: 3, createdAt: minutesAgo(10) },
        { id: 'c', score: 4, createdAt: minutesAgo(1) },
      ],
      NOW,
    );
    expect(results.map((r) => r.counted)).toEqual([true, true, true]);
    expect(summarizeCountedRatings(results)).toEqual({ average: 4, count: 3 });
  });

  it('publie automatiquement en lot 48h apres la 1ère note si le seuil de 3 n’est pas atteint', () => {
    const notYet = computeRatingVisibility(
      [
        { id: 'a', score: 5, createdAt: hoursAgo(47) },
        { id: 'b', score: 3, createdAt: hoursAgo(30) },
      ],
      NOW,
    );
    expect(notYet.map((r) => r.counted)).toEqual([false, false]);

    const afterFallback = computeRatingVisibility(
      [
        { id: 'a', score: 5, createdAt: hoursAgo(49) },
        { id: 'b', score: 3, createdAt: hoursAgo(30) },
      ],
      NOW,
    );
    expect(afterFallback.map((r) => r.counted)).toEqual([true, true]);
    expect(summarizeCountedRatings(afterFallback)).toEqual({ average: 4, count: 2 });
  });

  it('publie meme une seule note en attente au bout de 48h', () => {
    const results = computeRatingVisibility([{ id: 'a', score: 5, createdAt: hoursAgo(49) }], NOW);
    expect(results.map((r) => r.counted)).toEqual([true]);
    expect(summarizeCountedRatings(results)).toEqual({ average: 5, count: 1 });
  });

  it('applique un delai de 6h a toute nouvelle note arrivant apres activation', () => {
    const base = [
      { id: 'a', score: 5, createdAt: hoursAgo(3) },
      { id: 'b', score: 3, createdAt: hoursAgo(2) },
      { id: 'c', score: 4, createdAt: hoursAgo(1) },
    ];
    // 'd' arrive apres activation (posterieure a 'c'), toujours dans la fenetre des 6h.
    const dCreatedAt = minutesAgo(30);
    const ratings = [...base, { id: 'd', score: 1, createdAt: dCreatedAt }];

    const justArrived = computeRatingVisibility(ratings, NOW);
    expect(justArrived.find((r) => r.id === 'd')!.counted).toBe(false);
    expect(summarizeCountedRatings(justArrived)).toEqual({ average: 4, count: 3 });

    const sevenHoursLater = computeRatingVisibility(ratings, new Date(NOW.getTime() + 7 * 3_600_000));
    expect(sevenHoursLater.find((r) => r.id === 'd')!.counted).toBe(true);
    expect(summarizeCountedRatings(sevenHoursLater)).toEqual({ average: 3.25, count: 4 });
  });

  it('exclut une note masquee de la moyenne publique meme si son delai est passe', () => {
    const results = computeRatingVisibility(
      [
        { id: 'a', score: 5, createdAt: hoursAgo(3) },
        { id: 'b', score: 3, createdAt: hoursAgo(2), isHidden: true },
        { id: 'c', score: 4, createdAt: hoursAgo(1) },
      ],
      NOW,
    );
    expect(summarizeCountedRatings(results)).toEqual({ average: 4.5, count: 2 });
  });

  it('exclut totalement une note annulee (n’occupe aucun rang, ne compte pas pour le seuil de 3)', () => {
    const results = computeRatingVisibility(
      [
        { id: 'a', score: 5, createdAt: minutesAgo(30) },
        { id: 'b', score: 3, createdAt: minutesAgo(20), isCancelled: true },
        { id: 'c', score: 4, createdAt: minutesAgo(10) },
      ],
      NOW,
    );
    // seules 'a' et 'c' restent (rang 1 et 2) : toujours sous le seuil de 3.
    expect(results.map((r) => r.id)).toEqual(['a', 'c']);
    expect(results.every((r) => !r.counted)).toBe(true);
  });

  it('ne renvoie jamais une note isolee (toujours moyenne + nombre)', () => {
    const results = computeRatingVisibility(
      [
        { id: 'a', score: 5, createdAt: hoursAgo(49) },
        { id: 'b', score: 1, createdAt: hoursAgo(30) },
      ],
      NOW,
    );
    const summary = summarizeCountedRatings(results);
    expect(summary).not.toHaveProperty('score');
    expect(summary.count).toBe(2);
  });
});
