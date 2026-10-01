// Adaptateur API Engagement (GET /v0/mission, format legacy documenté).
// Contrat vérifié dans le dépôt officiel betagouv/api-engagement : voir
// ../../apiEngagement.ts pour la correspondance champ par champ.
//
// Visuels : la réponse v0 ne contient AUCUNE photo de mission, seulement
// organizationLogo / domainLogo / publisherLogo. L'adaptateur ne renvoie donc
// aucune image candidate ; les logos sont portés par la ligne de mission et
// affichés comme des logos (niveaux 3 et 4 de la hiérarchie).
import { API_ENGAGEMENT_PROD_URL, mapApiEngagementMission } from '../../apiEngagement.ts';
import { HttpStatusError } from '../http.ts';
import type { AdapterContext, FetchResult, SourceAdapter, SourceMission, SkippedItem } from '../types.ts';

const PAGE_SIZE = 100;

function numberFrom(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export const apiEngagementAdapter: SourceAdapter = {
  async fetchMissions(ctx: AdapterContext): Promise<FetchResult> {
    const apiKey = (ctx.env('API_ENGAGEMENT_KEY') ?? '').trim();
    if (!apiKey) {
      return {
        notConfigured: "API_ENGAGEMENT_KEY n'est pas configurée : aucune mission lue ni modifiée.",
        missions: [],
        skipped: [],
        fetched: 0,
        complete: false,
      };
    }

    const config = ctx.source.config ?? {};
    const baseUrl = (ctx.env('API_ENGAGEMENT_URL') ?? ctx.source.base_url ?? API_ENGAGEMENT_PROD_URL).replace(/\/+$/, '');
    const lat = numberFrom(ctx.env('IMPORT_LAT') ?? config.lat, 50.6292);
    const lon = numberFrom(ctx.env('IMPORT_LON') ?? config.lon, 3.0573);
    const distanceKm = numberFrom(ctx.env('IMPORT_DISTANCE_KM') ?? config.distance_km, 25);
    const maxMissions = numberFrom(ctx.env('IMPORT_MAX_MISSIONS') ?? config.max_missions, 2000);
    const types = Array.isArray(config.types) && config.types.length > 0 ? config.types.map(String) : ['benevolat'];

    const missions: SourceMission[] = [];
    const skipped: SkippedItem[] = [];
    let fetched = 0;
    let total: number | null = null;
    let complete = false;

    for (let skip = 0; skip < maxMissions; skip += PAGE_SIZE) {
      const url = new URL(`${baseUrl}/v0/mission`);
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lon));
      url.searchParams.set('distance', `${distanceKm}km`);
      for (const type of types) url.searchParams.append('type', type);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('skip', String(skip));

      let response: Response;
      try {
        // API officielle à clé : contrat d'accès explicite, robots.txt ne s'applique pas.
        response = await ctx.http.get(url.toString(), { headers: { 'x-api-key': apiKey }, checkRobots: false });
      } catch (error) {
        if (error instanceof HttpStatusError && error.status === 401) {
          throw new Error('Clé API Engagement refusée (401) : vérifier API_ENGAGEMENT_KEY.');
        }
        throw error;
      }
      const body = await response.json();
      if (body?.ok === false) throw new Error(`API Engagement : ${body.code ?? 'erreur'} ${body.message ?? ''}`.trim());
      const data: unknown[] = Array.isArray(body?.data) ? body.data : [];
      total = typeof body?.total === 'number' ? body.total : total;
      fetched += data.length;

      for (const item of data) {
        const result = mapApiEngagementMission(item, { now: ctx.now, center: { lat, lng: lon }, baseUrl });
        if (result.ok) missions.push({ row: result.row, images: [] });
        else skipped.push({ externalId: result.externalId, reason: result.reason });
      }
      if (data.length < PAGE_SIZE || (total != null && skip + PAGE_SIZE >= total)) {
        complete = true;
        break;
      }
    }

    return {
      missions,
      skipped,
      fetched,
      complete,
      note: complete ? null : `Parcours limité à ${maxMissions} missions (total annoncé : ${total ?? 'inconnu'}).`,
    };
  },
};
