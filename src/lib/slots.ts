import type { MissionSlot } from '@/types/database.types';

// Helpers du planning par journee (missions jusqu'a 3 jours).

export function slotMinutes(s: MissionSlot): number {
  const [sh, sm] = s.start.split(':').map(Number);
  const [eh, em] = s.end.split(':').map(Number);
  return (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0));
}

export function totalMinutes(slots: MissionSlot[]): number {
  return slots.reduce((sum, s) => sum + Math.max(slotMinutes(s), 0), 0);
}

export function distinctDays(slots: MissionSlot[]): string[] {
  return [...new Set(slots.map((s) => s.date))].sort();
}

function dayNumber(date: string): number {
  const d = new Date(date + 'T00:00:00');
  return Math.round(d.getTime() / 86400000);
}

export function areConsecutiveDays(slots: MissionSlot[]): boolean {
  const days = distinctDays(slots);
  if (days.length <= 1) return true;
  return days.every((day, i) => i === 0 || dayNumber(day) - dayNumber(days[i - 1]!) === 1);
}

// Étendue en jours (1 à 3) entre le premier et le dernier créneau.
export function spanDays(slots: MissionSlot[]): number {
  const days = distinctDays(slots);
  if (days.length === 0) return 0;
  const first = new Date(days[0] + 'T00:00:00');
  const last = new Date(days[days.length - 1] + 'T00:00:00');
  return Math.round((last.getTime() - first.getTime()) / 86400000) + 1;
}

export function formatDay(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Résumé compact pour les cartes : "sam. 12 juil. · 11:00–15:00" ou "2 jours · 12 h".
export function scheduleSummary(slots: MissionSlot[] | null, fallbackDate: string, fallbackTime: string | null): string {
  if (!slots || slots.length === 0) {
    return fallbackTime ? `${fallbackDate} · ${fallbackTime.slice(0, 5)}` : fallbackDate;
  }
  const days = distinctDays(slots);
  const first = days[0] ?? fallbackDate;
  const last = days[days.length - 1] ?? first;
  if (days.length === 1) {
    const ranges = slots
      .slice()
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((s) => `${s.start}–${s.end}`)
      .join(' et ');
    return `${formatDay(first)} · ${ranges}`;
  }
  return `${formatDay(first)} → ${formatDay(last)} · ${days.length} jours`;
}

// Planning détaillé groupé par jour, pour l'écran "Voir la mission".
export function groupByDay(slots: MissionSlot[]): Array<{ date: string; ranges: string[] }> {
  return distinctDays(slots).map((date) => ({
    date,
    ranges: slots
      .filter((s) => s.date === date)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((s) => `${s.start} – ${s.end}`),
  }));
}
