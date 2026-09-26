// Edge Function `import-api-engagement` — alimente le catalogue des missions
// solidaires externes (phase 0 : résoudre le démarrage à froid).
//
// Récupère les missions de bénévolat autour de la MEL depuis l'API
// Engagement, les convertit (_shared/apiEngagement.ts) et les upsert dans
// public.external_missions (clé : source + external_id). Les missions de la
// source qui n'apparaissent plus sont désactivées, jamais supprimées : les
// candidatures externes qui les référencent restent intactes.
//
// Accès réservé au backend (clé service_role ou IMPORT_CRON_SECRET).
// Secrets requis : API_ENGAGEMENT_KEY.
// Optionnels : API_ENGAGEMENT_URL, IMPORT_LAT, IMPORT_LON, IMPORT_DISTANCE_KM.
// À planifier (pg_cron + pg_net ou Scheduled Function) une à deux fois par jour.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { API_ENGAGEMENT_SOURCE, mapApiEngagementMission, type ExternalMissionRow } from "../_shared/apiEngagement.ts";

const PAGE_SIZE = 50;
const MAX_PAGES = 20;

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json" };
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée." }), { status: 405, headers });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("IMPORT_CRON_SECRET") ?? "";
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!provided || (provided !== serviceRoleKey && (!cronSecret || provided !== cronSecret))) {
    return new Response(JSON.stringify({ error: "Accès réservé au backend UROSI." }), { status: 401, headers });
  }

  const apiKey = Deno.env.get("API_ENGAGEMENT_KEY") ?? "";
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API_ENGAGEMENT_KEY manquante." }), { status: 503, headers });
  }

  const baseUrl = Deno.env.get("API_ENGAGEMENT_URL") ?? "https://api.api-engagement.beta.gouv.fr/v0/mission/search";
  const lat = Deno.env.get("IMPORT_LAT") ?? "50.6292";
  const lon = Deno.env.get("IMPORT_LON") ?? "3.0573";
  const distance = Deno.env.get("IMPORT_DISTANCE_KM") ?? "25";

  const rows: ExternalMissionRow[] = [];
  let skipped = 0;
  let complete = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
    url.searchParams.set("distance", `${distance}km`);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("skip", String(page * PAGE_SIZE));

    const response = await fetch(url, { headers: { "x-api-key": apiKey, Accept: "application/json" } });
    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `API Engagement a répondu ${response.status}.`, imported: 0 }),
        { status: 502, headers },
      );
    }
    const body = await response.json();
    const data: unknown[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    for (const item of data) {
      const row = mapApiEngagementMission(item);
      if (row) rows.push(row);
      else skipped++;
    }
    if (data.length < PAGE_SIZE) {
      complete = true;
      break;
    }
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceRoleKey, {
    auth: { persistSession: false },
  });

  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((row) => ({ ...row, updated_at: now }));
    const { error } = await supabase.from("external_missions").upsert(chunk, { onConflict: "source,external_id" });
    if (error) {
      return new Response(JSON.stringify({ error: error.message, imported: i }), { status: 500, headers });
    }
  }

  // Désactivation uniquement si le parcours de l'API est allé au bout :
  // une pagination interrompue ne doit pas masquer des missions valides.
  let deactivated = 0;
  if (complete) {
    const { data, error } = await supabase
      .from("external_missions")
      .update({ is_active: false, updated_at: now })
      .eq("source", API_ENGAGEMENT_SOURCE)
      .eq("is_active", true)
      .lt("updated_at", now)
      .select("id");
    if (!error) deactivated = (data ?? []).length;
  }

  return new Response(JSON.stringify({ imported: rows.length, skipped, deactivated, complete }), { status: 200, headers });
});
