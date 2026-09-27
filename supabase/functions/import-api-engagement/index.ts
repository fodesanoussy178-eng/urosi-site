// Edge Function `import-api-engagement` — alimente le catalogue des missions
// solidaires externes (phase 0 : résoudre le démarrage à froid).
//
// Contrat vérifié sur la documentation officielle (voir _shared/apiEngagement.ts).
// Appelle GET {API_ENGAGEMENT_URL}/v0/mission (réponse { ok, total, data,
// limit, skip }) avec l'en-tête `x-api-key`, autour de la MEL, bénévolat
// uniquement, puis upsert dans public.external_missions (clé : source + _id).
// Les missions de la source non revues lors d'un parcours COMPLET sont
// désactivées, jamais supprimées (les candidatures externes restent intactes).
// Chaque exécution est tracée dans public.external_import_runs.
//
// Déclenchement :
//   - manuel : bouton « Relancer l'import » du Centre Fondateur (jeton de
//     session d'un compte fondateur, vérifié via has_founder_access()) ;
//   - planifié : pg_cron + pg_net avec IMPORT_CRON_SECRET (voir
//     supabase/manual/schedule_api_engagement_import.sql), à activer une fois
//     la vraie clé reçue.
//
// Secrets : API_ENGAGEMENT_KEY (obligatoire pour importer ; absente = run
// journalisé « not_configured », aucune donnée modifiée), IMPORT_CRON_SECRET.
// Optionnels : API_ENGAGEMENT_URL (défaut production ; bac à sable :
// https://api.bac-a-sable.api-engagement.beta.gouv.fr), IMPORT_LAT,
// IMPORT_LON, IMPORT_DISTANCE_KM, IMPORT_MAX_MISSIONS.
// Déploiement : verify_jwt=false (l'authentification est faite ici même).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  API_ENGAGEMENT_PROD_URL,
  API_ENGAGEMENT_SOURCE,
  PHASE0_MISSION_TYPES,
  mapApiEngagementMission,
  type ExternalMissionRow,
  type SkipReason,
} from "../_shared/apiEngagement.ts";

const PAGE_SIZE = 100;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function fetchPage(url: URL, apiKey: string): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: { "x-api-key": apiKey, Accept: "application/json" } });
    if (response.status !== 429) return response;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  return fetch(url, { headers: { "x-api-key": apiKey, Accept: "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("IMPORT_CRON_SECRET") ?? "";
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!provided) return json({ error: "Accès réservé à l'équipe UROSI." }, 401);

  let trigger: "manual" | "cron";
  let triggeredBy: string | null = null;
  if (provided === serviceRoleKey || (cronSecret && provided === cronSecret)) {
    trigger = "cron";
  } else {
    // Jeton de session : seul un compte fondateur peut relancer l'import.
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${provided}` } },
    });
    const { data: userData } = await userClient.auth.getUser(provided);
    const { data: isFounder } = await userClient.rpc("has_founder_access");
    if (!userData?.user || isFounder !== true) return json({ error: "Accès réservé à l'équipe UROSI." }, 403);
    trigger = "manual";
    triggeredBy = userData.user.id;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: run, error: runError } = await admin
    .from("external_import_runs")
    .insert({ source: API_ENGAGEMENT_SOURCE, trigger, triggered_by: triggeredBy })
    .select("id")
    .single();
  if (runError || !run) return json({ error: runError?.message ?? "Journal d'import indisponible." }, 500);

  const finish = async (patch: Record<string, unknown>, status = 200) => {
    await admin.from("external_import_runs").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", run.id);
    return json({ run_id: run.id, ...patch }, status);
  };

  const apiKey = (Deno.env.get("API_ENGAGEMENT_KEY") ?? "").trim();
  if (!apiKey) {
    return finish({
      status: "not_configured",
      error_message: "API_ENGAGEMENT_KEY n'est pas configurée : aucun import effectué.",
    });
  }

  const baseUrl = (Deno.env.get("API_ENGAGEMENT_URL") ?? API_ENGAGEMENT_PROD_URL).replace(/\/+$/, "");
  const lat = Number(Deno.env.get("IMPORT_LAT") ?? "50.6292");
  const lon = Number(Deno.env.get("IMPORT_LON") ?? "3.0573");
  const distanceKm = Number(Deno.env.get("IMPORT_DISTANCE_KM") ?? "25");
  const maxMissions = Number(Deno.env.get("IMPORT_MAX_MISSIONS") ?? "2000");
  const startedAt = new Date().toISOString();

  const rows: ExternalMissionRow[] = [];
  const skipReasons: Partial<Record<SkipReason, number>> = {};
  let fetched = 0;
  let complete = false;
  let total: number | null = null;

  try {
    for (let skip = 0; skip < maxMissions; skip += PAGE_SIZE) {
      const url = new URL(`${baseUrl}/v0/mission`);
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lon));
      url.searchParams.set("distance", `${distanceKm}km`);
      for (const type of PHASE0_MISSION_TYPES) url.searchParams.append("type", type);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("skip", String(skip));

      const response = await fetchPage(url, apiKey);
      if (response.status === 401) throw new Error("Clé API Engagement refusée (401) : vérifier API_ENGAGEMENT_KEY.");
      if (!response.ok) throw new Error(`API Engagement a répondu ${response.status}.`);
      const body = await response.json();
      if (body?.ok === false) throw new Error(`API Engagement : ${body.code ?? "erreur"} ${body.message ?? ""}`.trim());
      const data: unknown[] = Array.isArray(body?.data) ? body.data : [];
      total = typeof body?.total === "number" ? body.total : total;
      fetched += data.length;

      for (const item of data) {
        const result = mapApiEngagementMission(item, { center: { lat, lng: lon } });
        if (result.ok) rows.push(result.row);
        else skipReasons[result.reason] = (skipReasons[result.reason] ?? 0) + 1;
      }
      if (data.length < PAGE_SIZE || (total != null && skip + PAGE_SIZE >= total)) {
        complete = true;
        break;
      }
    }
  } catch (error) {
    return finish({ status: "error", fetched, error_message: (error as Error).message, skip_reasons: skipReasons }, 502);
  }

  // Doublons éventuels entre pages : la dernière version l'emporte.
  const unique = [...new Map(rows.map((r) => [r.external_id, r])).values()];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200).map((row) => ({ ...row, last_seen_at: startedAt, updated_at: startedAt }));
    const { error } = await admin.from("external_missions").upsert(chunk, { onConflict: "source,external_id" });
    if (error) {
      return finish({ status: "error", fetched, imported: i, error_message: error.message, skip_reasons: skipReasons }, 500);
    }
  }

  // Désactivation seulement après un parcours complet : une pagination
  // interrompue (ou un plafond atteint) ne doit pas masquer des missions.
  let deactivated = 0;
  if (complete) {
    const { data, error } = await admin
      .from("external_missions")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("source", API_ENGAGEMENT_SOURCE)
      .eq("is_active", true)
      .lt("last_seen_at", startedAt)
      .select("id");
    if (!error) deactivated = (data ?? []).length;
  }

  const skipped = Object.values(skipReasons).reduce((a, b) => a + (b ?? 0), 0);
  return finish({
    status: complete ? "success" : "partial",
    fetched,
    imported: unique.length,
    skipped,
    deactivated,
    skip_reasons: skipReasons,
    error_message: complete ? null : `Parcours limité à ${maxMissions} missions (total annoncé : ${total ?? "inconnu"}).`,
  });
});
