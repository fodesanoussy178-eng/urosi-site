// Agent de découverte des missions — une exécution complète.
//
// Pour chaque source ACTIVÉE du registre public.mission_sources :
//   1. lecture via son adaptateur (API, open data, RSS/XML/JSON, pages
//      autorisées ; robots.txt et protections anti-bot respectés) ;
//   2. pour chaque mission : identifiant externe, existence, empreinte du
//      contenu (création / mise à jour / inchangée / réactivation) ;
//   3. visuel choisi selon la hiérarchie commune (missionVisual.ts) — une
//      image aux droits inconnus est enregistrée pour vérification mais
//      jamais publiée ;
//   4. missions rejetées (supprimées, statut changé, expirées...) et, après
//      un parcours complet, missions disparues : DÉSACTIVÉES, jamais supprimées.
// Puis, toutes sources confondues : expiration, dédoublonnage (titre +
// structure + lieu + date) et journal de synchronisation.
import type { ExternalMissionRow } from '../apiEngagement.ts';
import { isPublishableRights, resolveMissionVisual } from '../missionVisual.ts';
import { AntiBotError, RobotsDisallowedError, type PoliteHttp } from './http.ts';
import type {
  AdapterContext,
  AgentStore,
  DeactivationReason,
  ImageCandidate,
  MissionSource,
  SourceAdapter,
  StoredMissionRow,
} from './types.ts';

export type SourceStatus = 'success' | 'partial' | 'not_configured' | 'blocked' | 'error' | 'skipped';

export interface SourceReport {
  source: string;
  name: string;
  status: SourceStatus;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  reactivated: number;
  deactivated: number;
  skipped: number;
  skip_reasons: Record<string, number>;
  images_found: number;
  images_rejected: number;
  message: string | null;
}

export interface AgentRunSummary {
  run_id: string;
  status: 'success' | 'partial' | 'error' | 'not_configured';
  fetched: number;
  imported: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  reactivated_count: number;
  skipped: number;
  deactivated: number;
  duplicates: number;
  without_image: number;
  images_found: number;
  images_rejected: number;
  skip_reasons: Record<string, number>;
  sources_report: SourceReport[];
  errors: Array<{ source: string; message: string }>;
  error_message: string | null;
}

export interface RunAgentOptions {
  store: AgentStore;
  adapters: Record<string, SourceAdapter>;
  http: PoliteHttp;
  env: (name: string) => string | undefined;
  trigger: 'manual' | 'cron';
  triggeredBy?: string | null;
  now?: Date;
  // Restreint l'exécution à certaines sources (ex. relance d'une seule).
  onlySources?: string[];
}

// Motif de rejet d'une mission → motif de désactivation si elle était publiée.
const SKIP_TO_DEACTIVATION: Record<string, DeactivationReason | undefined> = {
  deleted: 'deleted_at_source',
  not_accepted: 'status_changed',
  expired: 'expired',
  type_excluded: 'excluded',
  compensated: 'excluded',
  remote_full: 'excluded',
  missing_application_url: 'excluded',
};

// Empreinte stable (cyrb53) : identique en Deno et en Node, sans dépendance.
export function stableHash(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// Champs « métier » comparés pour détecter une modification (pas le brut
// de la source ni les horodatages de synchronisation).
export function contentHash(row: ExternalMissionRow, visual: { image_url: string | null; image_source: string }): string {
  const { raw: _raw, ...business } = row;
  return stableHash(canonical({ ...business, ...visual }));
}

// Une image partenaire n'est publiable que si la source est explicitement
// déclarée comme fournissant des photos réutilisables ; sinon elle est
// conservée comme « droits inconnus » (refusée, visible par l'équipe UROSI).
export function vetImages(source: MissionSource, images: ImageCandidate[]): ImageCandidate[] {
  return images.map((img) => {
    if (img.source === 'partner_feed' && !source.mission_images_reusable && img.rightsStatus !== 'unknown') {
      return { ...img, rightsStatus: 'unknown', note: img.note ?? 'Source non déclarée comme fournissant des photos réutilisables.' };
    }
    return img;
  });
}

export function chooseVisual(source: MissionSource, row: ExternalMissionRow, images: ImageCandidate[]) {
  const best = (kind: ImageCandidate['source']) => images.find((i) => i.source === kind && isPublishableRights(i.rightsStatus));
  const partner = best('partner_feed');
  const authorized = best('authorized_source');
  const visual = resolveMissionVisual({
    partnerMissionImage: partner ? { url: partner.url, rightsStatus: partner.rightsStatus } : null,
    authorizedImage: authorized ? { url: authorized.url, rightsStatus: authorized.rightsStatus } : null,
    organizationLogo: source.logos_reusable ? { url: row.organization_logo_url, rightsStatus: 'source_provided' } : null,
    domainLogo: source.logos_reusable ? { url: row.domain_logo_url, rightsStatus: 'source_provided' } : null,
  });
  return {
    image_url: visual.kind === 'photo' ? visual.url : null,
    image_source: visual.level,
    image_rights_status: visual.rightsStatus,
    primaryUrl: visual.kind === 'photo' ? visual.url : null,
  };
}

function emptyReport(source: MissionSource): SourceReport {
  return {
    source: source.id,
    name: source.name,
    status: 'success',
    fetched: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    reactivated: 0,
    deactivated: 0,
    skipped: 0,
    skip_reasons: {},
    images_found: 0,
    images_rejected: 0,
    message: null,
  };
}

async function runSource(source: MissionSource, adapter: SourceAdapter, ctx: AdapterContext, store: AgentStore, report: SourceReport) {
  const result = await adapter.fetchMissions(ctx);
  if (result.notConfigured) {
    report.status = 'not_configured';
    report.message = result.notConfigured;
    return;
  }
  report.fetched = result.fetched;
  const nowIso = ctx.now.toISOString();
  const existing = new Map((await store.loadExisting(source.id)).map((e) => [e.external_id, e]));

  // Doublons éventuels entre pages : la dernière version l'emporte.
  const byId = new Map(result.missions.map((m) => [m.row.external_id, m]));
  const rows: StoredMissionRow[] = [];
  const imagesById = new Map<string, { images: ImageCandidate[]; primaryUrl: string | null }>();

  for (const mission of byId.values()) {
    let images = mission.images;
    if (adapter.findImages) {
      images = [...images, ...(await adapter.findImages(mission.row, ctx).catch(() => []))];
    }
    images = vetImages(source, images);
    const visual = chooseVisual(source, mission.row, images);
    const hash = contentHash(mission.row, { image_url: visual.image_url, image_source: visual.image_source });
    const previous = existing.get(mission.row.external_id);
    const changed = !previous || previous.content_hash !== hash;
    if (!previous) report.created++;
    else if (!previous.is_active) report.reactivated++;
    else if (changed) report.updated++;
    else report.unchanged++;

    rows.push({
      ...mission.row,
      image_url: visual.image_url,
      image_source: visual.image_source,
      image_rights_status: visual.image_rights_status,
      content_hash: hash,
      is_active: true,
      last_checked_at: nowIso,
      last_seen_at: nowIso,
      last_changed_at: changed || !previous?.last_changed_at ? nowIso : previous.last_changed_at,
      updated_at: nowIso,
    });
    if (images.length > 0 || visual.primaryUrl) imagesById.set(mission.row.external_id, { images, primaryUrl: visual.primaryUrl });
    report.images_found += images.filter((i) => isPublishableRights(i.rightsStatus)).length;
    report.images_rejected += images.filter((i) => i.rightsStatus === 'unknown').length;
  }

  const ids = await store.upsertMissions(rows);
  for (const [externalId, { images, primaryUrl }] of imagesById) {
    const id = ids.get(externalId);
    if (id) await store.syncExternalImages(id, images, primaryUrl);
  }

  // Missions rejetées qui étaient publiées : désactivées avec leur motif.
  const toDeactivate = new Map<DeactivationReason, string[]>();
  for (const item of result.skipped) {
    report.skip_reasons[item.reason] = (report.skip_reasons[item.reason] ?? 0) + 1;
    const reason = SKIP_TO_DEACTIVATION[item.reason];
    const previous = item.externalId ? existing.get(item.externalId) : undefined;
    if (reason && previous?.is_active && !byId.has(previous.external_id)) {
      toDeactivate.set(reason, [...(toDeactivate.get(reason) ?? []), previous.id]);
    }
  }
  report.skipped = result.skipped.length;

  // Parcours complet uniquement : une pagination interrompue ne doit jamais
  // masquer des missions encore publiées.
  if (result.complete) {
    const rejected = new Set(result.skipped.map((s) => s.externalId).filter(Boolean));
    const missing = [...existing.values()]
      .filter((e) => e.is_active && !byId.has(e.external_id) && !rejected.has(e.external_id))
      .map((e) => e.id);
    if (missing.length > 0) toDeactivate.set('removed_at_source', missing);
  } else {
    report.status = 'partial';
    report.message = result.note ?? 'Parcours incomplet : aucune mission disparue n’a été désactivée.';
  }
  for (const [reason, list] of toDeactivate) report.deactivated += await store.deactivate(list, reason);
}

export async function runMissionAgent(options: RunAgentOptions): Promise<AgentRunSummary> {
  const { store, adapters, http, env, trigger } = options;
  const now = options.now ?? new Date();
  const runId = await store.startRun(trigger, options.triggeredBy ?? null);
  const reports: SourceReport[] = [];
  const errors: Array<{ source: string; message: string }> = [];

  let sources: MissionSource[] = [];
  try {
    sources = (await store.loadSources()).filter((s) => !options.onlySources || options.onlySources.includes(s.id));
  } catch (error) {
    errors.push({ source: 'registre', message: (error as Error).message });
  }

  for (const source of sources) {
    const report = emptyReport(source);
    reports.push(report);
    // Double garde : le registre l'impose déjà (contrainte SQL).
    if (!source.enabled || !source.automated_access_allowed) {
      report.status = 'skipped';
      report.message = 'Source désactivée ou accès automatisé non autorisé.';
      // Ses missions encore publiées sont retirées du catalogue (désactivées).
      try {
        const stillActive = (await store.loadExisting(source.id)).filter((e) => e.is_active).map((e) => e.id);
        if (stillActive.length > 0) report.deactivated = await store.deactivate(stillActive, 'source_disabled');
      } catch (error) {
        errors.push({ source: source.id, message: (error as Error).message });
      }
      continue;
    }
    const adapter = adapters[source.adapter];
    if (!adapter) {
      report.status = 'error';
      report.message = `Adaptateur « ${source.adapter} » non implémenté : source ignorée.`;
      errors.push({ source: source.id, message: report.message });
      continue;
    }
    try {
      await runSource(source, adapter, { source, env, http, now }, store, report);
    } catch (error) {
      const message = (error as Error).message;
      report.status = error instanceof AntiBotError || error instanceof RobotsDisallowedError ? 'blocked' : 'error';
      report.message = message;
      errors.push({ source: source.id, message });
    }
  }

  let expired = 0;
  let duplicates = 0;
  let withoutImage = 0;
  try {
    expired = await store.deactivateExpired();
    duplicates = await store.refreshDuplicates();
    withoutImage = await store.countWithoutImage();
  } catch (error) {
    errors.push({ source: 'maintenance', message: (error as Error).message });
  }

  const sum = (key: keyof SourceReport) => reports.reduce((acc, r) => acc + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0);
  const skipReasons: Record<string, number> = {};
  for (const r of reports) for (const [k, v] of Object.entries(r.skip_reasons)) skipReasons[k] = (skipReasons[k] ?? 0) + v;

  const worked = reports.filter((r) => r.status === 'success' || r.status === 'partial');
  const failed = reports.filter((r) => r.status === 'error' || r.status === 'blocked');
  let status: AgentRunSummary['status'];
  if (worked.length === 0 && failed.length === 0 && errors.length === 0) status = 'not_configured';
  else if (worked.length === 0) status = 'error';
  else if (failed.length > 0 || errors.length > 0 || worked.some((r) => r.status === 'partial')) status = 'partial';
  else status = 'success';

  const summary: AgentRunSummary = {
    run_id: runId,
    status,
    fetched: sum('fetched'),
    imported: sum('created') + sum('updated') + sum('unchanged') + sum('reactivated'),
    created_count: sum('created'),
    updated_count: sum('updated'),
    unchanged_count: sum('unchanged'),
    reactivated_count: sum('reactivated'),
    skipped: sum('skipped'),
    deactivated: sum('deactivated') + expired,
    duplicates,
    without_image: withoutImage,
    images_found: sum('images_found'),
    images_rejected: sum('images_rejected'),
    skip_reasons: skipReasons,
    sources_report: reports,
    errors,
    error_message:
      errors.map((e) => `${e.source} : ${e.message}`).join(' · ') ||
      reports.filter((r) => r.message).map((r) => `${r.name} : ${r.message}`).join(' · ') ||
      null,
  };
  const { run_id: _id, ...patch } = summary;
  await store.finishRun(runId, { ...patch, finished_at: new Date().toISOString() });
  return summary;
}
