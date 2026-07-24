import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Verification officielle d'une structure francaise via l'API publique
// "Recherche d'entreprises" (api.gouv.fr, source SIRENE/INSEE). L'appel a
// l'API se fait UNIQUEMENT ici, cote serveur — jamais depuis le navigateur.
// Le SIRET vient toujours de la ligne structures elle-meme (lecture via le
// jeton du proprietaire), jamais d'une valeur soumise en clair par le
// client : impossible de faire "verifier" un autre SIRET que celui reellement
// enregistre.
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
  numero_voie?: string;
  type_voie?: string;
  libelle_voie?: string;
  code_postal?: string;
  libelle_commune?: string;
  activite_principale?: string;
  libelle_activite_principale?: string;
  date_creation?: string;
}

interface SireneResult {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  nom_entreprise?: string;
  nature_juridique?: string;
  activite_principale?: string;
  libelle_activite_principale?: string;
  date_creation?: string;
  etat_administratif?: string;
  siege?: Etablissement;
  matching_etablissements?: Etablissement[];
}

type Status = "verified" | "pending" | "closed" | "not_found";

// Le SIRET recherche peut correspondre au siege (etablissement principal) ou
// a un etablissement secondaire de la meme entreprise (matching_etablissements) :
// les deux cas sont traites explicitement, jamais une simple supposition.
function findEstablishment(result: SireneResult, siret: string): Etablissement | null {
  if (result.siege?.siret === siret) return result.siege;
  const match = (result.matching_etablissements ?? []).find((e) => e.siret === siret);
  return match ?? null;
}

function buildAddress(etab: Etablissement): string | null {
  const parts = [etab.numero_voie, etab.type_voie, etab.libelle_voie].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function statusMessage(status: Status): string {
  switch (status) {
    case "verified":
      return "Structure vérifiée automatiquement auprès du registre officiel.";
    case "closed":
      return "Cet établissement est déclaré fermé au registre officiel.";
    case "not_found":
      return "Aucun établissement actif ne correspond à ce SIRET dans le registre officiel.";
    default:
      return "Informations incomplètes ou temporairement indisponibles — vérification manuelle nécessaire.";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) throw new Error("Identifiants Supabase manquants côté fonction.");

    const authHeader = req.headers.get("Authorization") || "";
    // Un seul client, avec le jeton du proprietaire : la RPC
    // apply_structure_siret_verification revalide elle-meme la propriete
    // (owner_id = auth.uid() ou fondateur) — jamais de cle service_role ici.
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });

    // verify_jwt desactive au niveau passerelle : meme lecon que
    // founder-test-mode (« unrecognized JWT kid ») — la verification reelle
    // se fait ici via un appel a GoTrue, l'autorite qui a emis le jeton.
    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Non authentifié." }, 401);

    const body = await req.json().catch(() => ({}));
    const structureId = body?.structureId;
    if (!structureId || typeof structureId !== "string") {
      return json({ error: "Paramètre 'structureId' manquant." }, 400);
    }

    const { data: structure, error: structureError } = await callerClient
      .from("structures")
      .select("id, owner_id, siret, verification_method")
      .eq("id", structureId)
      .maybeSingle();
    if (structureError || !structure) return json({ error: "Structure introuvable." }, 404);
    if (structure.owner_id !== authData.user.id) {
      const { data: isFounder } = await callerClient.rpc("has_founder_access");
      if (!isFounder) return json({ error: "Accès refusé." }, 403);
    }

    if (structure.verification_method === "founder") {
      return json({ status: "verified", message: "Compte de test Fondateur — déjà vérifié fictivement." });
    }

    const siret = String(structure.siret ?? "").replace(/\D/g, "");
    if (siret.length !== 14) {
      return json({ error: "Aucun SIRET valide n'est enregistré pour cette structure." }, 400);
    }

    async function applyResult(
      status: Status,
      fields: Record<string, unknown> = {},
      payload: unknown = null,
    ) {
      const { error } = await callerClient.rpc("apply_structure_siret_verification", {
        p_structure_id: structureId,
        p_status: status,
        p_payload: payload,
        ...fields,
      });
      if (error) throw new Error(error.message);
      return json({ status, message: statusMessage(status) });
    }

    let apiResponse: Response;
    try {
      apiResponse = await fetch(`${SIRENE_SEARCH_URL}?q=${encodeURIComponent(siret)}&per_page=1`);
    } catch {
      return await applyResult("pending", {}, { error: "network_error" });
    }

    if (!apiResponse.ok) {
      return await applyResult("pending", {}, { error: `http_${apiResponse.status}` });
    }

    const data = await apiResponse.json().catch(() => null);
    const result: SireneResult | undefined = data?.results?.[0];
    if (!result) {
      return await applyResult("not_found");
    }

    const etab = findEstablishment(result, siret);
    if (!etab) {
      return await applyResult("not_found");
    }

    const legalCategoryCode = result.nature_juridique ?? null;
    const name = result.nom_complet || result.nom_raison_sociale || result.nom_entreprise || null;
    const adminState = etab.etat_administratif ?? result.etat_administratif ?? null;
    const closed = adminState === "F" || result.etat_administratif === "C";
    const address = buildAddress(etab);
    const postalCode = etab.code_postal ?? null;
    const city = etab.libelle_commune ?? null;
    const nafCode = etab.activite_principale ?? result.activite_principale ?? null;
    const nafLabel = etab.libelle_activite_principale ?? result.libelle_activite_principale ?? null;
    const establishedAt = etab.date_creation ?? result.date_creation ?? null;

    const payload = {
      siren: result.siren ?? null,
      nom_complet: name,
      nature_juridique: legalCategoryCode,
      activite_principale: nafCode,
      etat_administratif: adminState,
      date_creation: establishedAt,
      adresse: { numero_voie: etab.numero_voie, type_voie: etab.type_voie, libelle_voie: etab.libelle_voie, code_postal: postalCode, libelle_commune: city },
    };

    const status: Status = closed ? "closed" : !name || !postalCode || !city ? "pending" : "verified";

    return await applyResult(
      status,
      {
        p_name: name,
        p_siren: result.siren ?? null,
        p_postal_code: postalCode,
        p_city: city,
        p_address: address,
        p_naf_code: nafCode,
        p_naf_label: nafLabel,
        p_legal_form: null,
        p_admin_state: adminState,
        p_established_at: establishedAt,
        p_legal_category_code: legalCategoryCode,
      },
      payload,
    );
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erreur inconnue." }, 500);
  }
});
