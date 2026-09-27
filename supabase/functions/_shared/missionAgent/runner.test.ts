import { describe, expect, it } from 'vitest';
import { mapApiEngagementMission, type ExternalMissionRow } from '../apiEngagement';
import { AntiBotError, createPoliteHttp } from './http';
import { runMissionAgent } from './runner';
import { apiEngagementAdapter } from './sources/apiEngagement';
import type { AgentStore, DeactivationReason, ExistingMission, FetchResult, ImageCandidate, MissionSource, SourceAdapter, StoredMissionRow } from './types';

const NOW = new Date('2026-09-27T12:00:00Z');

function apiMission(id: string, patch: Record<string, unknown> = {}) {
  return {
    _id: id,
    clientId: `c-${id}`,
    publisherId: 'pub',
    publisherName: 'JeVeuxAider.gouv.fr',
    statusCode: 'ACCEPTED',
    type: 'benevolat',
    title: `Mission ${id}`,
    description: 'Aider.',
    domain: 'solidarite-insertion',
    domainLogo: 'https://cdn.example.org/domain.png',
    organizationName: 'Association Test',
    organizationLogo: 'https://cdn.example.org/org.png',
    city: 'Lille',
    startAt: '2026-10-10T08:00:00.000Z',
    applicationUrl: `https://api.api-engagement.beta.gouv.fr/r/${id}/pub`,
    ...patch,
  };
}

function rowOf(id: string, patch: Record<string, unknown> = {}): ExternalMissionRow {
  const r = mapApiEngagementMission(apiMission(id, patch), { now: NOW });
  if (!r.ok) throw new Error(r.reason);
  return r.row;
}

const API_SOURCE: MissionSource = {
  id: 'api_engagement',
  name: 'API Engagement',
  source_type: 'api',
  adapter: 'api_engagement_v0',
  base_url: 'https://api.api-engagement.beta.gouv.fr',
  enabled: true,
  automated_access_allowed: true,
  mission_images_reusable: false,
  logos_reusable: true,
  reuse_basis: 'API publique, clé diffuseur',
  config: {},
};

class MemoryStore implements AgentStore {
  sources: MissionSource[] = [API_SOURCE];
  missions = new Map<string, StoredMissionRow & { id: string; deactivation_reason?: DeactivationReason | null }>();
  images: Array<ImageCandidate & { external_mission_id: string; is_primary: boolean }> = [];
  runs = new Map<string, Record<string, unknown>>();
  private seq = 0;

  async loadSources() {
    return this.sources;
  }
  async startRun(trigger: string) {
    const id = `run-${++this.seq}`;
    this.runs.set(id, { trigger });
    return id;
  }
  async finishRun(id: string, patch: Record<string, unknown>) {
    this.runs.set(id, { ...this.runs.get(id), ...patch });
  }
  async loadExisting(sourceId: string): Promise<ExistingMission[]> {
    return [...this.missions.values()]
      .filter((m) => m.source === sourceId)
      .map((m) => ({ id: m.id, external_id: m.external_id, content_hash: m.content_hash, is_active: m.is_active, last_changed_at: m.last_changed_at }));
  }
  async upsertMissions(rows: StoredMissionRow[]) {
    const ids = new Map<string, string>();
    for (const row of rows) {
      const key = `${row.source}:${row.external_id}`;
      const id = this.missions.get(key)?.id ?? `m-${++this.seq}`;
      this.missions.set(key, { ...row, id, deactivation_reason: null });
      ids.set(row.external_id, id);
    }
    return ids;
  }
  async deactivate(ids: string[], reason: DeactivationReason) {
    let n = 0;
    for (const m of this.missions.values()) {
      if (ids.includes(m.id) && m.is_active) {
        m.is_active = false;
        m.deactivation_reason = reason;
        n++;
      }
    }
    return n;
  }
  async syncExternalImages(externalMissionId: string, images: ImageCandidate[], primaryUrl: string | null) {
    for (const img of images) {
      if (!this.images.some((i) => i.external_mission_id === externalMissionId && i.url === img.url)) {
        this.images.push({ ...img, external_mission_id: externalMissionId, is_primary: false });
      }
    }
    for (const img of this.images.filter((i) => i.external_mission_id === externalMissionId)) {
      img.is_primary = img.url === primaryUrl && img.rightsStatus !== 'unknown';
    }
    return { inserted: images.length };
  }
  async deactivateExpired() {
    return 0;
  }
  async refreshDuplicates() {
    return 0;
  }
  async countWithoutImage() {
    return [...this.missions.values()].filter((m) => m.is_active && m.image_source === 'urosi_illustration').length;
  }
  get(externalId: string) {
    return this.missions.get(`api_engagement:${externalId}`)!;
  }
}

function fakeAdapter(results: FetchResult[], findImages?: SourceAdapter['findImages']): SourceAdapter {
  let call = 0;
  return { fetchMissions: async () => results[Math.min(call++, results.length - 1)]!, findImages };
}

const http = createPoliteHttp({ fetch: async () => new Response('{}'), sleep: async () => undefined, minIntervalMs: 0 });
const noEnv = () => undefined;

function run(store: MemoryStore, adapter: SourceAdapter, now = NOW) {
  return runMissionAgent({ store, adapters: { api_engagement_v0: adapter }, http, env: noEnv, trigger: 'cron', now });
}

describe('agent de découverte des missions', () => {
  it('crée, puis reconnaît une mission inchangée, puis détecte une modification', async () => {
    const store = new MemoryStore();
    const adapter = fakeAdapter([
      { missions: [{ row: rowOf('a'), images: [] }], skipped: [], fetched: 1, complete: true },
      { missions: [{ row: rowOf('a'), images: [] }], skipped: [], fetched: 1, complete: true },
      { missions: [{ row: rowOf('a', { places: 12 }), images: [] }], skipped: [], fetched: 1, complete: true },
    ]);
    const first = await run(store, adapter);
    expect(first).toMatchObject({ status: 'success', created_count: 1, updated_count: 0 });
    const firstChange = store.get('a').last_changed_at;

    const second = await run(store, adapter, new Date('2026-09-27T15:00:00Z'));
    expect(second).toMatchObject({ created_count: 0, updated_count: 0, unchanged_count: 1 });
    expect(store.get('a').last_changed_at).toBe(firstChange);
    expect(store.get('a').last_checked_at).toBe('2026-09-27T15:00:00.000Z');

    const third = await run(store, adapter, new Date('2026-09-27T18:00:00Z'));
    expect(third).toMatchObject({ updated_count: 1 });
    expect(store.get('a').last_changed_at).toBe('2026-09-27T18:00:00.000Z');
  });

  it('désactive (sans supprimer) les missions disparues après un parcours complet, et les réactive si elles reviennent', async () => {
    const store = new MemoryStore();
    const adapter = fakeAdapter([
      { missions: [{ row: rowOf('a'), images: [] }, { row: rowOf('b'), images: [] }], skipped: [], fetched: 2, complete: true },
      { missions: [{ row: rowOf('a'), images: [] }], skipped: [], fetched: 1, complete: true },
      { missions: [{ row: rowOf('a'), images: [] }, { row: rowOf('b'), images: [] }], skipped: [], fetched: 2, complete: true },
    ]);
    await run(store, adapter);
    const second = await run(store, adapter);
    expect(second.deactivated).toBe(1);
    expect(store.get('b')).toMatchObject({ is_active: false, deactivation_reason: 'removed_at_source' });
    expect(store.missions.size).toBe(2);
    const third = await run(store, adapter);
    expect(third.reactivated_count).toBe(1);
    expect(store.get('b').is_active).toBe(true);
  });

  it('ne désactive rien de ce qui manque quand le parcours est incomplet', async () => {
    const store = new MemoryStore();
    const adapter = fakeAdapter([
      { missions: [{ row: rowOf('a'), images: [] }, { row: rowOf('b'), images: [] }], skipped: [], fetched: 2, complete: true },
      { missions: [{ row: rowOf('a'), images: [] }], skipped: [], fetched: 1, complete: false, note: 'plafond atteint' },
    ]);
    await run(store, adapter);
    const second = await run(store, adapter);
    expect(second.status).toBe('partial');
    expect(second.deactivated).toBe(0);
    expect(store.get('b').is_active).toBe(true);
  });

  it('désactive avec leur motif les missions supprimées ou dont le statut a changé à la source', async () => {
    const store = new MemoryStore();
    const adapter = fakeAdapter([
      { missions: [{ row: rowOf('a'), images: [] }, { row: rowOf('b'), images: [] }], skipped: [], fetched: 2, complete: true },
      { missions: [], skipped: [{ externalId: 'a', reason: 'deleted' }, { externalId: 'b', reason: 'not_accepted' }], fetched: 2, complete: true },
    ]);
    await run(store, adapter);
    const second = await run(store, adapter);
    expect(second.deactivated).toBe(2);
    expect(second.skip_reasons).toEqual({ deleted: 1, not_accepted: 1 });
    expect(store.get('a').deactivation_reason).toBe('deleted_at_source');
    expect(store.get('b').deactivation_reason).toBe('status_changed');
  });

  it('applique la hiérarchie des visuels : logo d’organisation, sinon logo de domaine, sinon illustration', async () => {
    const store = new MemoryStore();
    const adapter = fakeAdapter([
      {
        missions: [
          { row: rowOf('logo'), images: [] },
          { row: rowOf('domain', { organizationLogo: null }), images: [] },
          { row: rowOf('none', { organizationLogo: null, domainLogo: null }), images: [] },
        ],
        skipped: [],
        fetched: 3,
        complete: true,
      },
    ]);
    const summary = await run(store, adapter);
    expect(store.get('logo')).toMatchObject({ image_source: 'organization_logo', image_rights_status: 'source_provided', image_url: null });
    expect(store.get('domain').image_source).toBe('domain_logo');
    expect(store.get('none')).toMatchObject({ image_source: 'urosi_illustration', image_rights_status: null });
    expect(summary.without_image).toBe(1);
  });

  it('publie une meilleure image seulement si ses droits sont connus ; refuse les droits inconnus', async () => {
    const store = new MemoryStore();
    const licensed: ImageCandidate = { url: 'https://images.example.org/ok.jpg', source: 'authorized_source', sourceUrl: 'https://images.example.org/ok', rightsStatus: 'licensed', license: 'CC BY 4.0' };
    const unknown: ImageCandidate = { url: 'https://site.example.org/vue.jpg', source: 'authorized_source', sourceUrl: 'https://site.example.org/page', rightsStatus: 'unknown' };
    const adapter = fakeAdapter(
      [{ missions: [{ row: rowOf('a'), images: [] }, { row: rowOf('b'), images: [] }], skipped: [], fetched: 2, complete: true }],
      async (mission) => (mission.external_id === 'a' ? [unknown, licensed] : [unknown]),
    );
    const summary = await run(store, adapter);
    expect(store.get('a')).toMatchObject({ image_source: 'authorized_image', image_url: licensed.url, image_rights_status: 'licensed' });
    expect(store.get('b').image_source).toBe('organization_logo');
    expect(summary.images_found).toBe(1);
    expect(summary.images_rejected).toBe(2);
    expect(store.images.filter((i) => i.is_primary).map((i) => i.url)).toEqual([licensed.url]);
    expect(store.images.find((i) => i.rightsStatus === 'unknown' && i.is_primary)).toBeUndefined();
  });

  it('une photo « fournie par la source » est refusée si la source n’est pas déclarée réutilisable', async () => {
    const store = new MemoryStore();
    const photo: ImageCandidate = { url: 'https://cdn.example.org/photo.jpg', source: 'partner_feed', sourceUrl: null, rightsStatus: 'source_provided' };
    const adapter = fakeAdapter([{ missions: [{ row: rowOf('a'), images: [photo] }], skipped: [], fetched: 1, complete: true }]);
    const summary = await run(store, adapter);
    expect(store.get('a').image_source).toBe('organization_logo');
    expect(summary.images_rejected).toBe(1);

    store.sources = [{ ...API_SOURCE, mission_images_reusable: true }];
    await run(store, fakeAdapter([{ missions: [{ row: rowOf('a'), images: [photo] }], skipped: [], fetched: 1, complete: true }]));
    expect(store.get('a')).toMatchObject({ image_source: 'partner_mission_image', image_url: photo.url });
  });

  it('source non configurée : run « non configuré », rien n’est modifié', async () => {
    const store = new MemoryStore();
    const summary = await runMissionAgent({ store, adapters: { api_engagement_v0: apiEngagementAdapter }, http, env: noEnv, trigger: 'manual', now: NOW });
    expect(summary.status).toBe('not_configured');
    expect(summary.sources_report[0]).toMatchObject({ status: 'not_configured' });
    expect(store.missions.size).toBe(0);
    expect(store.runs.get(summary.run_id)).toMatchObject({ status: 'not_configured' });
  });

  it('source désactivée : jamais interrogée, ses missions publiées sont désactivées', async () => {
    const store = new MemoryStore();
    await run(store, fakeAdapter([{ missions: [{ row: rowOf('a'), images: [] }], skipped: [], fetched: 1, complete: true }]));
    store.sources = [{ ...API_SOURCE, enabled: false }];
    let called = false;
    const summary = await run(store, { fetchMissions: async () => { called = true; throw new Error('ne doit pas être appelé'); } });
    expect(called).toBe(false);
    expect(summary.sources_report[0]).toMatchObject({ status: 'skipped', deactivated: 1 });
    expect(store.get('a').deactivation_reason).toBe('source_disabled');
  });

  it('protection anti-bot : la source est marquée bloquée, sans contournement, les autres continuent', async () => {
    const store = new MemoryStore();
    store.sources = [API_SOURCE, { ...API_SOURCE, id: 'flux_test', name: 'Flux test', adapter: 'flux', source_type: 'rss' }];
    const blocked: SourceAdapter = { fetchMissions: async () => { throw new AntiBotError('https://flux.example.org/rss', 'défi Cloudflare'); } };
    const summary = await runMissionAgent({
      store,
      adapters: { api_engagement_v0: fakeAdapter([{ missions: [{ row: rowOf('a'), images: [] }], skipped: [], fetched: 1, complete: true }]), flux: blocked },
      http,
      env: noEnv,
      trigger: 'cron',
      now: NOW,
    });
    expect(summary.status).toBe('partial');
    expect(summary.sources_report.map((r) => r.status)).toEqual(['success', 'blocked']);
    expect(summary.errors[0]?.message).toMatch(/anti-bot/);
  });

  it('adaptateur inconnu : source ignorée et erreur journalisée', async () => {
    const store = new MemoryStore();
    store.sources = [{ ...API_SOURCE, adapter: 'inexistant' }];
    const summary = await runMissionAgent({ store, adapters: {}, http, env: noEnv, trigger: 'cron', now: NOW });
    expect(summary.status).toBe('error');
    expect(summary.errors[0]?.message).toMatch(/non implémenté/);
  });
});

describe('adaptateur API Engagement', () => {
  it('interroge GET /v0/mission avec x-api-key, pagine et ne lit aucune photo', async () => {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const page = (data: unknown[], total: number) => new Response(JSON.stringify({ ok: true, total, data, limit: 100, skip: 0 }));
    const pages = [page(Array.from({ length: 100 }, (_, i) => apiMission(`p1-${i}`)), 101), page([apiMission('p2-0', { image: 'https://x.example.org/p.jpg' })], 101)];
    const fetcher = async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers });
      return pages.shift()!;
    };
    const result = await apiEngagementAdapter.fetchMissions({
      source: API_SOURCE,
      env: (name) => (name === 'API_ENGAGEMENT_KEY' ? 'cle-de-test' : undefined),
      http: createPoliteHttp({ fetch: fetcher, sleep: async () => undefined, minIntervalMs: 0 }),
      now: NOW,
    });
    expect(result).toMatchObject({ fetched: 101, complete: true });
    expect(result.missions).toHaveLength(101);
    expect(result.missions.every((m) => m.images.length === 0 && m.row.image_url === null)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain('/v0/mission?');
    expect(calls[0]!.url).toContain('type=benevolat');
    expect(calls[1]!.url).toContain('skip=100');
    expect(calls[0]!.headers?.['x-api-key']).toBe('cle-de-test');
    expect(calls.some((c) => c.url.endsWith('/robots.txt'))).toBe(false);
  });
});
