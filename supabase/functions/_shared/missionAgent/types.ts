import type { ExternalMissionRow } from '../apiEngagement.ts';
import type { RightsStatus } from '../missionVisual.ts';
import type { PoliteHttp } from './http.ts';

export type SourceType = 'api' | 'open_data' | 'rss' | 'xml' | 'json' | 'authorized_page';

// Ligne de public.mission_sources.
export interface MissionSource {
  id: string;
  name: string;
  source_type: SourceType;
  adapter: string;
  base_url: string;
  enabled: boolean;
  automated_access_allowed: boolean;
  mission_images_reusable: boolean;
  logos_reusable: boolean;
  reuse_basis: string | null;
  config: Record<string, unknown>;
}

// Image candidate trouvée pour une mission, avec sa provenance exacte.
export interface ImageCandidate {
  url: string;
  // partner_feed : fournie par la source de la mission elle-même ;
  // authorized_source : trouvée sur une autre source dont l'usage est autorisé.
  source: 'partner_feed' | 'authorized_source';
  sourceUrl: string | null;
  rightsStatus: RightsStatus;
  license?: string | null;
  attribution?: string | null;
  note?: string | null;
}

export interface SourceMission {
  row: ExternalMissionRow;
  images: ImageCandidate[];
}

export interface SkippedItem {
  externalId: string | null;
  reason: string;
}

export interface FetchResult {
  // Source non configurée (clé absente...) : rien n'est modifié.
  notConfigured?: string;
  missions: SourceMission[];
  skipped: SkippedItem[];
  fetched: number;
  // Parcours complet : autorise la désactivation des missions disparues.
  complete: boolean;
  note?: string | null;
}

export interface AdapterContext {
  source: MissionSource;
  env: (name: string) => string | undefined;
  http: PoliteHttp;
  now: Date;
}

export interface SourceAdapter {
  fetchMissions(ctx: AdapterContext): Promise<FetchResult>;
  // Recherche facultative d'une meilleure image, UNIQUEMENT parmi des sources
  // dont l'usage est autorisé. Chaque image rendue porte son statut de droits.
  findImages?(mission: ExternalMissionRow, ctx: AdapterContext): Promise<ImageCandidate[]>;
}

export interface ExistingMission {
  id: string;
  external_id: string;
  content_hash: string | null;
  is_active: boolean;
  last_changed_at: string | null;
}

export type DeactivationReason =
  | 'removed_at_source'
  | 'deleted_at_source'
  | 'expired'
  | 'status_changed'
  | 'excluded'
  | 'source_disabled';

export interface StoredMissionRow extends ExternalMissionRow {
  content_hash: string;
  image_source: string;
  image_rights_status: RightsStatus | null;
  last_checked_at: string;
  last_changed_at: string;
  last_seen_at: string;
  updated_at: string;
}

export interface ImageSyncResult {
  inserted: number;
}

// Accès aux données de l'agent (Supabase en production, mémoire en test).
export interface AgentStore {
  loadSources(): Promise<MissionSource[]>;
  startRun(trigger: 'manual' | 'cron', triggeredBy: string | null): Promise<string>;
  finishRun(runId: string, patch: Record<string, unknown>): Promise<void>;
  loadExisting(sourceId: string): Promise<ExistingMission[]>;
  upsertMissions(rows: StoredMissionRow[]): Promise<Map<string, string>>;
  deactivate(ids: string[], reason: DeactivationReason): Promise<number>;
  syncExternalImages(externalMissionId: string, images: ImageCandidate[], primaryUrl: string | null): Promise<ImageSyncResult>;
  deactivateExpired(): Promise<number>;
  refreshDuplicates(): Promise<number>;
  countWithoutImage(): Promise<number>;
}
