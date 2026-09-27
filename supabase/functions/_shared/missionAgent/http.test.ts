import { describe, expect, it } from 'vitest';
import { AGENT_USER_AGENT, AntiBotError, RobotsDisallowedError, createPoliteHttp, parseRobots, robotsAllows } from './http';

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers });
    const route = routes[url];
    return route ? route() : new Response('introuvable', { status: 404 });
  };
  return { fetch, calls };
}

const quick = { sleep: async () => undefined, minIntervalMs: 0 };

describe('accès réseau poli de l’agent', () => {
  it('lit robots.txt (groupe * ou UROSI) avec la règle la plus longue gagnante', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /prive\nAllow: /prive/missions\n\nUser-agent: GPTBot\nDisallow: /');
    expect(robotsAllows(rules, '/missions')).toBe(true);
    expect(robotsAllows(rules, '/prive/compte')).toBe(false);
    expect(robotsAllows(rules, '/prive/missions/1')).toBe(true);
    const specific = parseRobots('User-agent: *\nAllow: /\n\nUser-agent: urosi-missionagent\nDisallow: /flux');
    expect(robotsAllows(specific, '/flux.xml')).toBe(false);
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /*.json$'), '/data/missions.json')).toBe(false);
  });

  it('refuse une page interdite par robots.txt et s’annonce avec un User-Agent explicite', async () => {
    const { fetch, calls } = fakeFetch({
      'https://asso.example.org/robots.txt': () => new Response('User-agent: *\nDisallow: /benevolat'),
      'https://asso.example.org/flux.xml': () => new Response('<rss/>'),
    });
    const http = createPoliteHttp({ fetch, ...quick });
    await expect(http.get('https://asso.example.org/benevolat/1', { checkRobots: true })).rejects.toBeInstanceOf(RobotsDisallowedError);
    await expect(http.get('https://asso.example.org/flux.xml', { checkRobots: true })).resolves.toBeInstanceOf(Response);
    expect(calls.filter((c) => c.url.endsWith('/robots.txt'))).toHaveLength(1);
    expect(calls.every((c) => c.headers?.['User-Agent'] === AGENT_USER_AGENT)).toBe(true);
  });

  it('robots.txt refusé au robot (403) = accès refusé', async () => {
    const { fetch } = fakeFetch({ 'https://x.example.org/robots.txt': () => new Response('', { status: 403 }) });
    await expect(createPoliteHttp({ fetch, ...quick }).get('https://x.example.org/a', { checkRobots: true })).rejects.toBeInstanceOf(RobotsDisallowedError);
  });

  it('s’arrête net face à une protection anti-bot, sans nouvelle tentative', async () => {
    const { fetch, calls } = fakeFetch({
      'https://x.example.org/robots.txt': () => new Response(''),
      'https://x.example.org/a': () => new Response('<title>Just a moment...</title>', { status: 403, headers: { 'cf-mitigated': 'challenge' } }),
      'https://y.example.org/robots.txt': () => new Response(''),
      'https://y.example.org/b': () => new Response('<div class="g-recaptcha">captcha</div>', { status: 429 }),
    });
    const http = createPoliteHttp({ fetch, ...quick });
    await expect(http.get('https://x.example.org/a', { checkRobots: true })).rejects.toBeInstanceOf(AntiBotError);
    await expect(http.get('https://y.example.org/b', { checkRobots: true })).rejects.toBeInstanceOf(AntiBotError);
    expect(calls.filter((c) => c.url === 'https://x.example.org/a')).toHaveLength(1);
    expect(calls.filter((c) => c.url === 'https://y.example.org/b')).toHaveLength(1);
  });

  it('respecte Retry-After une seule fois sur 429', async () => {
    let n = 0;
    const waits: number[] = [];
    const http = createPoliteHttp({
      fetch: async () => (++n === 1 ? new Response('trop', { status: 429, headers: { 'retry-after': '2' } }) : new Response('{}')),
      sleep: async (ms) => { waits.push(ms); },
      minIntervalMs: 0,
    });
    await expect(http.get('https://api.example.org/v0/mission', { checkRobots: false })).resolves.toBeInstanceOf(Response);
    expect(waits).toContain(2000);
    expect(n).toBe(2);
  });

  it('refuse le http non chiffré', async () => {
    const http = createPoliteHttp({ fetch: async () => new Response('{}'), ...quick });
    await expect(http.get('http://api.example.org/', { checkRobots: false })).rejects.toThrow(/https/);
  });
});
