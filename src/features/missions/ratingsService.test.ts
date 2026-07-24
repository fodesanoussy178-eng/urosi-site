import { describe, expect, it } from 'vitest';
import { RATING_FIRST_PROMPT_DELAY_MINUTES, shouldPromptRatingRequest } from './ratingsService';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe('shouldPromptRatingRequest', () => {
  it('ne propose pas l’avis immédiatement après la fin de mission', () => {
    expect(
      shouldPromptRatingRequest({ createdAt: minutesAgo(1), lastRemindedAt: null, reminderStage: 0 }),
    ).toBe(false);
  });

  it(`propose l’avis après ~${RATING_FIRST_PROMPT_DELAY_MINUTES} min`, () => {
    expect(
      shouldPromptRatingRequest({
        createdAt: minutesAgo(RATING_FIRST_PROMPT_DELAY_MINUTES + 1),
        lastRemindedAt: null,
        reminderStage: 0,
      }),
    ).toBe(true);
  });

  it('rappelle 24h après le premier rappel (étage 1)', () => {
    expect(
      shouldPromptRatingRequest({ createdAt: hoursAgo(25), lastRemindedAt: hoursAgo(25), reminderStage: 1 }),
    ).toBe(true);
    expect(
      shouldPromptRatingRequest({ createdAt: hoursAgo(25), lastRemindedAt: hoursAgo(1), reminderStage: 1 }),
    ).toBe(false);
  });

  it('ne relance plus au-delà de l’étage 3', () => {
    expect(
      shouldPromptRatingRequest({ createdAt: hoursAgo(100), lastRemindedAt: hoursAgo(80), reminderStage: 3 }),
    ).toBe(false);
  });
});
