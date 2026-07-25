// Edge Function `recheck-siret` — cron quotidien (Module 3).
//
// Deux roles :
//   1. Revérifier les SIRET travailleurs saisis mais pas encore actifs dans
//      Sirene (delai de propagation de quelques jours apres immatriculation).
//   2. Notifier les travailleurs dont le deblocage vient d'aboutir
//      (unlock_notified_at garantit un envoi unique).
//
// Sans cette fonction, un travailleur qui vient de creer son activite reste
// bloque sans jamais etre revérifie : c'est le principal point de perte du
// parcours.
//
// Acces reserve au backend : cle service_role uniquement (meme convention
// que release-internal-payments).
// Planifier via Supabase Scheduled Function ou pg_cron + pg_net, une fois par jour.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SIRENE_SEARCH_URL = "https://recherche-entreprises.api.gouv.fr/search";

async function isActiveInSirene(siret: string): Promise<"active" | "inactive" | "unavailable"> {
  try {
    const res = await fetch(`${SIRENE_SEARCH_URL}?q=${encodeURIComponent(siret)}&per_page=1`);
    if (!res.ok) return "unavailable";
    const data = await res.json().catch(() => null);
    const result = data?.results?.[0];
    if (!result) return "inactive";
    const siege = result.siege?.siret === siret ? result.siege : null;
    const match = (result.matching_etablissements ?? []).find((e: { siret?: string }) => e.siret === siret);
    const etab = siege ?? match;
    if (!etab) return "inactive";
    const state = etab.etat_administratif ?? result.etat_administratif;
    return state === "F" || state === "C" ? "inactive" : "active";
  } catch {
    return "unavailable";
  }
}

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json" };
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée." }), { status: 405, headers });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!serviceRoleKey || provided !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Accès réservé au backend UROSI." }), { status: 401, headers });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceRoleKey, {
    auth: { persistSession: false },
  });

  const report = { rechecked: 0, verified: 0, unavailable: 0, notified: 0 };

  const { data: pending, error: pendingErr } = await supabase.rpc("workers_siret_pending_recheck", {
    p_max_attempts: 30,
    p_limit: 200,
  });
  if (pendingErr) {
    return new Response(JSON.stringify({ error: pendingErr.message }), { status: 500, headers });
  }

  for (const p of (pending ?? []) as { profile_id: string; siret: string }[]) {
    report.rechecked++;
    const state = await isActiveInSirene(p.siret);
    if (state === "unavailable") {
      report.unavailable++;
      continue; // API indisponible : ne consomme pas de tentative.
    }
    const { error } = await supabase.rpc("record_worker_siret_recheck", {
      p_profile_id: p.profile_id,
      p_verified: state === "active",
    });
    if (!error && state === "active") report.verified++;
  }

  const { data: toNotify, error: notifyErr } = await supabase.rpc("workers_pending_unlock_notification", {
    p_limit: 200,
  });
  if (!notifyErr) {
    for (const p of (toNotify ?? []) as { profile_id: string }[]) {
      const { error } = await supabase.rpc("record_worker_unlock_notified", { p_profile_id: p.profile_id });
      if (!error) report.notified++;
    }
  }

  const startedAt = new Date(Date.now() - 1).toISOString();
  await supabase.rpc("record_cron_execution", {
    p_job_name: "recheck_siret",
    p_started_at: startedAt,
    p_checked: report.rechecked,
    p_released: report.verified,
    p_skipped: report.unavailable,
    p_failed: 0,
  });

  return new Response(JSON.stringify(report), { status: 200, headers });
});
