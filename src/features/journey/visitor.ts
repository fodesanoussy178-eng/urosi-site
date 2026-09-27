// Un visiteur peut candidater sans compte. Son appareil garde un identifiant
// anonyme et la liste de ses candidatures, pour lui demander après la date
// « Alors, ta mission ? » et rattacher le tout à son profil s'il en crée un.
const VISITOR_KEY = 'urosi_visitor_v1';
const CLICKS_KEY = 'urosi_clicks_v1';

export interface LocalClick {
  key: string; // clé de la mission (external:<id>)
  missionId: string;
  title: string;
  organization: string;
  // Date à partir de laquelle on demande « Alors, ta mission ? » (AAAA-MM-JJ).
  askAfter: string;
  clickedAt: string;
  answer?: 'went' | 'not_went';
  synced?: boolean;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible
  }
}

export function visitorId(): string {
  const existing = read<string | null>(VISITOR_KEY, null);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const created = crypto.randomUUID();
  write(VISITOR_KEY, created);
  return created;
}

export function localClicks(): LocalClick[] {
  const list = read<LocalClick[]>(CLICKS_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function rememberClick(click: LocalClick) {
  const list = localClicks().filter((c) => c.key !== click.key);
  write(CLICKS_KEY, [click, ...list].slice(0, 50));
}

export function answerLocalClick(key: string, answer: 'went' | 'not_went') {
  write(CLICKS_KEY, localClicks().map((c) => (c.key === key ? { ...c, answer } : c)));
}

export function markSynced(keys: string[]) {
  write(CLICKS_KEY, localClicks().map((c) => (keys.includes(c.key) ? { ...c, synced: true } : c)));
}

// Missions passées sans réponse (carte « Alors, ta mission ? » en visiteur).
export function pendingLocalQuestions(today: string): LocalClick[] {
  return localClicks().filter((c) => !c.answer && c.askAfter < today);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
