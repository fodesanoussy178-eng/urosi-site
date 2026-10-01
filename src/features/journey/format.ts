// Libellés courts des cartes et fiches : « Samedi · 3 h », « 📍 800 m ».
const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const SHORT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const FULL = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseDay(date: string): Date | null {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayIso(now = new Date()): string {
  return isoDay(now);
}

// « Aujourd'hui », « Demain », « Samedi » (dans la semaine), sinon « Sam. 12 oct. ».
export function dayLabel(date: string | null, now = new Date()): string | null {
  if (!date) return null;
  const d = parseDay(date);
  if (!d) return null;
  const start = parseDay(isoDay(now))!;
  const diff = Math.round((d.getTime() - start.getTime()) / 86_400_000);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Demain';
  if (diff > 1 && diff < 7) return capitalize(WEEKDAY.format(d));
  return capitalize(SHORT.format(d).replace(/\./g, '').replace(/^(\p{L}+)/u, '$1.'));
}

// « Samedi 4 octobre » (fiche mission).
export function longDayLabel(date: string | null): string | null {
  const d = date ? parseDay(date) : null;
  return d ? capitalize(LONG.format(d)) : null;
}

// « 28 septembre 2026 » (profil).
export function fullDateLabel(date: string | null): string | null {
  const d = date ? parseDay(date) : null;
  return d ? FULL.format(d) : null;
}

export function durationLabel(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

export function hoursLabel(start: string | null, end: string | null): string | null {
  const f = (t: string) => t.slice(0, 5).replace(/^0/, '').replace(':', 'h').replace(/h00$/, 'h');
  if (start && end) return `${f(start)} – ${f(end)}`;
  if (start) return `À partir de ${f(start)}`;
  return null;
}

export function distanceLabel(km: number | null): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.max(100, Math.round((km * 1000) / 100) * 100)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

export function totalHoursLabel(minutes: number): string {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} h`;
}
