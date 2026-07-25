import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Verification d'un SIRET travailleur (auto-entrepreneur/independant) via la
// meme API publique "Recherche d'entreprises" (api.gouv.fr, source SIRENE)
// que verify-structure — deja en production pour les structures, endpoint
// confirme et sans cle a gerer, contrairement au portail api.insee.fr direct
// (dont l'authentification a change et n'est plus a jour pour ce cas d'usage).
//
// Ne collecte AUCUNE piece d'identite, AUCUN IBAN : l'identite est verifiee
// par Stripe Connect/Identity (Module 1), pas par UROSI.
const SIRENE_SEARCH_URL = "https://recherche-entreprises.api.gouv.fr/search";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Etablissement {
  siret?: string;
  etat_administratif?: string;
}

interface SireneResult {
  etat_administratif?: string;
  siege?: Etablissement;
  matching_etablissements?: Etablissement[];
}

function findEstablishment(result: SireneResult, siret: string): Etablissement | null {
  if (result.siege?.siret === siret) return result.siege;
  const match = (result.matching_etablissements ?? []).find((e) => e.siret === siret);
  return match ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) throw new Error("Identifiants Supabase manquants côté fonction.");

    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });

    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const siret = String(body?.siret ?? "").replace(/\s/g, "");

    if (!/^\d{14}$/.test(siret)) {
      return json(
        { status: "invalid_format", message: "Un SIRET comporte 14 chiffres. Vérifie ta saisie." },
        400,
      );
    }

    async function applyResult(status: "verified" | "pending" | "closed") {
      const { data: paidStatus, error } = await callerClient.rpc("apply_worker_siret_verification", {
        p_siret: siret,
        p_status: status,
      });
      if (error) throw new Error(error.message);
      return { status, paid_status: paidStatus as string };
    }

    let apiResponse: Response;
    try {
      apiResponse = await fetch(`${SIRENE_SEARCH_URL}?q=${encodeURIComponent(siret)}&per_page=1`);
    } catch {
      const applied = await applyResult("pending");
      return json({
        ...applied,
        message:
          "Ton activité vient d'être créée : elle n'apparaît pas encore dans le répertoire officiel. " +
          "On revérifie automatiquement chaque jour et on te prévient dès que c'est bon.",
      });
    }

    if (!apiResponse.ok) {
      const applied = await applyResult("pending");
      return json({
        ...applied,
        message:
          "Ton activité vient d'être créée : elle n'apparaît pas encore dans le répertoire officiel. " +
          "On revérifie automatiquement chaque jour et on te prévient dès que c'est bon.",
      });
    }

    const data = await apiResponse.json().catch(() => null);
    const result: SireneResult | undefined = data?.results?.[0];
    const etab = result ? findEstablishment(result, siret) : null;

    if (!result || !etab) {
      const applied = await applyResult("pending");
      return json({
        ...applied,
        message:
          "Ton activité vient d'être créée : elle n'apparaît pas encore dans le répertoire officiel. " +
          "On revérifie automatiquement chaque jour et on te prévient dès que c'est bon.",
      });
    }

    const adminState = etab.etat_administratif ?? result.etat_administratif ?? null;
    if (adminState === "F" || adminState === "C") {
      const applied = await applyResult("closed");
      return json({
        ...applied,
        message: "Cet établissement est enregistré comme fermé. Vérifie le numéro ou contacte-nous si c'est une erreur.",
      });
    }

    const applied = await applyResult("verified");
    return json({
      ...applied,
      message: "Activité vérifiée automatiquement auprès du registre officiel.",
      next_step: applied.paid_status === "paid_eligible" ? null : "stripe_onboarding",
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erreur inconnue." }, 500);
  }
});
