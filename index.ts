import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalize(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looselyMatches(expected: string, found: string) {
  const a = normalize(expected);
  const b = normalize(found);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase service credentials are missing.");
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY") || "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Non authentifie." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { structureId, name, address, siret, siren } = await req.json();
    if (!structureId || !name || !address || !siret || !siren) {
      return new Response(JSON.stringify({ error: "Champs structure incomplets." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: structure, error: structureError } = await adminClient
      .from("structures")
      .select("id, owner_id")
      .eq("id", structureId)
      .single();

    if (structureError || !structure || structure.owner_id !== authData.user.id) {
      return new Response(JSON.stringify({ error: "Structure introuvable." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiUrl = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(siret)}&per_page=1`;
    const apiResponse = await fetch(apiUrl);

    if (!apiResponse.ok) {
      await adminClient
        .from("structures")
        .update({
          verification_status: "pending",
          verification_notes: "Verification externe indisponible, controle manuel requis.",
        })
        .eq("id", structureId);

      return new Response(JSON.stringify({ status: "pending" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await apiResponse.json();
    const result = payload?.results?.[0];
    const legalName = result?.nom_complet || result?.nom_raison_sociale || result?.nom_entreprise || "";
    const foundSiren = result?.siren || "";
    const foundSiret = result?.siege?.siret || result?.siret || "";
    const foundAddress = [
      result?.siege?.numero_voie,
      result?.siege?.type_voie,
      result?.siege?.libelle_voie,
      result?.siege?.code_postal,
      result?.siege?.libelle_commune,
    ].filter(Boolean).join(" ");
    const isActive = normalize(result?.etat_administratif) !== "cesse";

    const legalOk = looselyMatches(name, legalName);
    const addressOk = looselyMatches(address, foundAddress);
    const idsOk = foundSiren === siren || foundSiret === siret;
    const verified = Boolean(result && isActive && idsOk && legalOk && addressOk);

    const status = verified ? "verified" : "rejected";
    const notes = verified
      ? "Structure verifiee automatiquement avec l'Annuaire des Entreprises."
      : "Les informations declarees ne correspondent pas assez au registre public.";

    await adminClient
      .from("structures")
      .update({
        legal_name: legalName || name,
        verification_status: status,
        verification_notes: notes,
        verified_at: verified ? new Date().toISOString() : null,
      })
      .eq("id", structureId);

    return new Response(JSON.stringify({ status, notes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
