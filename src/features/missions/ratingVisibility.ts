// Miroir pur (sans I/O) de private.rating_visibility() cote SQL
// (supabase/migrations/20260726111920_bilateral_rating_visibility_and_moderation.sql).
// Sert de filet de securite pour verifier la regle de visibilite publique
// bilaterale (travailleur <-> structure) independamment de la base de
// donnees. Ne remplace jamais la RPC serveur (seule source de verite), mais
// garantit par des tests unitaires que la regle est bien comprise et stable.
export interface RatingVisibilityInput {
  id: string;
  score: number;
  createdAt: string;
  isHidden?: boolean;
  isCancelled?: boolean;
}

export interface RatingVisibilityResult {
  id: string;
  score: number;
  createdAt: string;
  scheduledPublishAt: string;
  counted: boolean;
}

export interface RatingSummary {
  average: number | null;
  count: number;
}

const ACTIVATION_FALLBACK_HOURS = 48;
const NEW_RATING_DELAY_HOURS = 6;
const MIN_RATINGS_FOR_INSTANT_DISPLAY = 3;

// Notes annulees : jamais dans le calcul, comme si elles n'avaient jamais
// existe (n'occupent aucun rang, ne comptent pas pour atteindre 3).
export function computeRatingVisibility(ratings: RatingVisibilityInput[], now: Date = new Date()): RatingVisibilityResult[] {
  const active = ratings
    .filter((r) => !r.isCancelled)
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));

  if (active.length === 0) return [];

  const firstCreatedAtMs = new Date(active[0]!.createdAt).getTime();
  const thirdCreatedAtMs =
    active.length >= MIN_RATINGS_FOR_INSTANT_DISPLAY
      ? new Date(active[MIN_RATINGS_FOR_INSTANT_DISPLAY - 1]!.createdAt).getTime()
      : null;
  const fallbackAtMs = firstCreatedAtMs + ACTIVATION_FALLBACK_HOURS * 3_600_000;
  const activatesAtMs = thirdCreatedAtMs === null ? fallbackAtMs : Math.min(thirdCreatedAtMs, fallbackAtMs);

  const nowMs = now.getTime();

  return active.map((r) => {
    const createdAtMs = new Date(r.createdAt).getTime();
    const scheduledPublishMs =
      createdAtMs <= activatesAtMs ? activatesAtMs : createdAtMs + NEW_RATING_DELAY_HOURS * 3_600_000;
    return {
      id: r.id,
      score: r.score,
      createdAt: r.createdAt,
      scheduledPublishAt: new Date(scheduledPublishMs).toISOString(),
      counted: !r.isHidden && nowMs >= scheduledPublishMs,
    };
  });
}

// Jamais de note isolee : uniquement moyenne + nombre d'avis comptes.
export function summarizeCountedRatings(results: RatingVisibilityResult[]): RatingSummary {
  const counted = results.filter((r) => r.counted);
  if (counted.length === 0) return { average: null, count: 0 };
  const sum = counted.reduce((acc, r) => acc + r.score, 0);
  return { average: Math.round((sum / counted.length) * 100) / 100, count: counted.length };
}
