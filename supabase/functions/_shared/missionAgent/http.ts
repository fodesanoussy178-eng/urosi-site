// Accès réseau « poli » de l'agent de découverte. Règles non négociables :
//   - l'agent s'annonce (User-Agent explicite), sans se faire passer pour un
//     navigateur, sans cookies ni session volés ;
//   - hors API officielle à clé, robots.txt est lu et respecté ;
//   - toute protection anti-bot (défi, captcha, blocage 403 de pare-feu) ARRÊTE
//     la lecture de la source : aucune tentative de contournement ;
//   - un 429 n'est réessayé qu'en respectant Retry-After (plafonné), une fois.
// Module pur (fetch injecté) : testable hors Deno.

export const AGENT_USER_AGENT = 'UROSI-MissionAgent/1.0 (agent de découverte de missions solidaires)';
const AGENT_TOKEN = 'urosi-missionagent';

export class AntiBotError extends Error {
  constructor(url: string, detail: string) {
    super(`Protection anti-bot détectée sur ${new URL(url).host} (${detail}) : source suspendue, aucun contournement.`);
    this.name = 'AntiBotError';
  }
}

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt de ${new URL(url).host} interdit l'accès automatisé à ${new URL(url).pathname}.`);
    this.name = 'RobotsDisallowedError';
  }
}

export class HttpStatusError extends Error {
  constructor(public status: number, url: string) {
    super(`${new URL(url).host} a répondu ${status}.`);
    this.name = 'HttpStatusError';
  }
}

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export interface PoliteHttpOptions {
  fetch: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  maxRetryAfterMs?: number;
}

export interface GetOptions {
  headers?: Record<string, string>;
  // API officielle avec clé (contrat d'accès explicite) : robots.txt ne
  // s'applique pas. Pour tout le reste (open data, flux, pages autorisées),
  // robots.txt est vérifié.
  checkRobots: boolean;
}

// Détection d'un défi anti-bot (Cloudflare, captcha, etc.).
export function antiBotSignal(response: Response, bodySample: string): string | null {
  if (response.headers.get('cf-mitigated') === 'challenge') return 'défi Cloudflare';
  if (/captcha|challenge-platform|cf-chl|just a moment|verify you are human|access denied|bot detected/i.test(bodySample)) {
    return 'page de vérification';
  }
  if (response.status === 403 && /cloudflare|akamai|imperva|datadome|incapsula/i.test(response.headers.get('server') ?? '')) {
    return `blocage ${response.headers.get('server')}`;
  }
  return null;
}

interface RobotsRule {
  allow: boolean;
  path: string;
}

// Lecteur robots.txt minimal : groupes « * » et « urosi-missionagent »,
// règle la plus longue gagnante, Allow l'emporte à égalité.
export function parseRobots(text: string): RobotsRule[] {
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if (key === 'disallow' && value) current.rules.push({ allow: false, path: value });
      if (key === 'allow' && value) current.rules.push({ allow: true, path: value });
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a === AGENT_TOKEN || a === 'urosi'));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function ruleMatches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith('$');
  const pattern = (anchored ? rulePath.slice(0, -1) : rulePath)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
}

export function robotsAllows(rules: RobotsRule[], pathWithQuery: string): boolean {
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule.path, pathWithQuery)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

export function createPoliteHttp(options: PoliteHttpOptions) {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const minInterval = options.minIntervalMs ?? 500;
  const maxRetryAfter = options.maxRetryAfterMs ?? 30_000;
  const robotsCache = new Map<string, RobotsRule[]>();
  const lastCall = new Map<string, number>();

  async function throttle(host: string) {
    const last = lastCall.get(host);
    const wait = last == null ? 0 : last + minInterval - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall.set(host, Date.now());
  }

  async function robotsFor(url: URL): Promise<RobotsRule[]> {
    const cached = robotsCache.get(url.origin);
    if (cached) return cached;
    let rules: RobotsRule[] = [];
    await throttle(url.host);
    const response = await options.fetch(`${url.origin}/robots.txt`, { headers: { 'User-Agent': AGENT_USER_AGENT } });
    if (response.ok) {
      rules = parseRobots(await response.text());
    } else if (response.status === 401 || response.status === 403) {
      // robots.txt inaccessible pour un robot : on considère l'accès refusé.
      rules = [{ allow: false, path: '/' }];
    }
    robotsCache.set(url.origin, rules);
    return rules;
  }

  async function get(target: string, getOptions: GetOptions): Promise<Response> {
    const url = new URL(target);
    if (url.protocol !== 'https:') throw new Error(`Accès refusé : ${url.host} n'est pas en https.`);
    if (getOptions.checkRobots) {
      const rules = await robotsFor(url);
      if (!robotsAllows(rules, `${url.pathname}${url.search}`)) throw new RobotsDisallowedError(target);
    }
    const headers = { 'User-Agent': AGENT_USER_AGENT, Accept: 'application/json, application/xml;q=0.9, */*;q=0.5', ...getOptions.headers };
    for (let attempt = 0; attempt < 2; attempt++) {
      await throttle(url.host);
      const response = await options.fetch(target, { headers });
      if (response.ok) return response;
      const sample = await response.clone().text().then((t) => t.slice(0, 4000)).catch(() => '');
      const signal = antiBotSignal(response, sample);
      if (signal) throw new AntiBotError(target, signal);
      if (response.status === 429 && attempt === 0) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000;
        if (waitMs > maxRetryAfter) throw new HttpStatusError(429, target);
        await sleep(waitMs);
        continue;
      }
      throw new HttpStatusError(response.status, target);
    }
    throw new HttpStatusError(429, target);
  }

  return { get };
}

export type PoliteHttp = ReturnType<typeof createPoliteHttp>;
