// Implémentation Supabase (service_role) de l'accès aux données de l'agent.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { AgentStore, DeactivationReason, ExistingMission, ImageCandidate, MissionSource, StoredMissionRow } from './types.ts';

const CHUNK = 200;

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context} : ${error.message}`);
}

export function createSupabaseAgentStore(admin: SupabaseClient): AgentStore {
  return {
    async loadSources(): Promise<MissionSource[]> {
      const { data, error } = await admin
        .from('mission_sources')
        .select('id, name, source_type, adapter, base_url, enabled, automated_access_allowed, mission_images_reusable, logos_reusable, reuse_basis, config')
        .order('id');
      fail('Registre des sources', error);
      return (data ?? []) as MissionSource[];
    },

    async startRun(trigger, triggeredBy): Promise<string> {
      const { data, error } = await admin
        .from('external_import_runs')
        .insert({ source: 'mission_agent', trigger, triggered_by: triggeredBy })
        .select('id')
        .single();
      fail('Journal de synchronisation', error);
      return (data as { id: string }).id;
    },

    async finishRun(runId, patch): Promise<void> {
      const { error } = await admin.from('external_import_runs').update(patch).eq('id', runId);
      fail('Clôture du journal', error);
    },

    async loadExisting(sourceId): Promise<ExistingMission[]> {
      const all: ExistingMission[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin
          .from('external_missions')
          .select('id, external_id, content_hash, is_active, last_changed_at')
          .eq('source', sourceId)
          .order('id')
          .range(from, from + 999);
        fail('Lecture des missions existantes', error);
        all.push(...((data ?? []) as ExistingMission[]));
        if (!data || data.length < 1000) break;
      }
      return all;
    },

    async upsertMissions(rows: StoredMissionRow[]): Promise<Map<string, string>> {
      const ids = new Map<string, string>();
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { data, error } = await admin
          .from('external_missions')
          .upsert(rows.slice(i, i + CHUNK), { onConflict: 'source,external_id' })
          .select('id, external_id');
        fail('Enregistrement des missions', error);
        for (const r of (data ?? []) as Array<{ id: string; external_id: string }>) ids.set(r.external_id, r.id);
      }
      return ids;
    },

    async deactivate(ids: string[], reason: DeactivationReason): Promise<number> {
      let count = 0;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error } = await admin
          .from('external_missions')
          .update({ is_active: false, deactivation_reason: reason, updated_at: new Date().toISOString() })
          .in('id', ids.slice(i, i + CHUNK))
          .eq('is_active', true)
          .select('id');
        fail('Désactivation', error);
        count += (data ?? []).length;
      }
      return count;
    },

    async syncExternalImages(externalMissionId: string, images: ImageCandidate[], primaryUrl: string | null) {
      let inserted = 0;
      if (images.length > 0) {
        const { data, error } = await admin
          .from('mission_images')
          .upsert(
            images.map((img, index) => ({
              external_mission_id: externalMissionId,
              image_url: img.url,
              source: img.source,
              source_url: img.sourceUrl,
              rights_status: img.rightsStatus,
              rights_note: img.note ?? null,
              license: img.license ?? null,
              attribution: img.attribution ?? null,
              position: Math.min(index, 5),
              is_primary: false,
            })),
            { onConflict: 'external_mission_id,image_url', ignoreDuplicates: true },
          )
          .select('id');
        fail('Images de mission', error);
        inserted = (data ?? []).length;
      }
      // Image principale : une seule, jamais aux droits inconnus.
      const { error: resetError } = await admin
        .from('mission_images')
        .update({ is_primary: false })
        .eq('external_mission_id', externalMissionId)
        .eq('is_primary', true);
      fail('Image principale', resetError);
      if (primaryUrl) {
        const { error } = await admin
          .from('mission_images')
          .update({ is_primary: true })
          .eq('external_mission_id', externalMissionId)
          .eq('image_url', primaryUrl)
          .neq('rights_status', 'unknown');
        fail('Image principale', error);
      }
      return { inserted };
    },

    async deactivateExpired(): Promise<number> {
      const { data, error } = await admin.rpc('agent_deactivate_expired');
      fail('Missions expirées', error);
      return Number(data ?? 0);
    },

    async refreshDuplicates(): Promise<number> {
      const { data, error } = await admin.rpc('agent_refresh_duplicates');
      fail('Dédoublonnage', error);
      return Number(data ?? 0);
    },

    async countWithoutImage(): Promise<number> {
      const { count, error } = await admin
        .from('external_missions')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('image_source', 'urosi_illustration');
      fail('Missions sans image', error);
      return count ?? 0;
    },
  };
}
