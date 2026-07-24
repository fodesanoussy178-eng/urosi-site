import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Comptes de test dedies, jamais de vrais utilisateurs : le mode Fondateur
// n'usurpe QUE ces deux identites, creees/reutilisees ici a la demande.
const TEST_ACCOUNTS: Record<"worker" | "structure", { email: string; fullName: string }> = {
  worker: { email: "founder-test-worker@urosi.internal", fullName: "Worker Test Fondateur" },
  structure: { email: "founder-test-structure@urosi.internal", fullName: "Structure Test Fondateur" },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      throw new Error("Identifiants Supabase manquants côté fonction.");
    }

    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Non authentifié." }, 401);

    // Seul un compte ayant réellement l'accès Fondateur peut déclencher une
    // bascule de session — jamais un compte de test lui-même (has_founder_access
    // renvoie false pour eux), jamais un compte réel quelconque.
    const { data: isFounder, error: founderError } = await callerClient.rpc("has_founder_access");
    if (founderError || !isFounder) return json({ error: "Accès Fondateur requis." }, 403);

    const body = await req.json().catch(() => ({}));
    const as = body?.as;
    if (as !== "worker" && as !== "structure") {
      return json({ error: "Paramètre 'as' invalide : 'worker' ou 'structure' attendu." }, 400);
    }

    const target = TEST_ACCOUNTS[as];
    const role = as === "structure" ? "structure_admin" : "worker";

    // Cherche le compte de test deja provisionne pour ce role.
    const { data: existing } = await adminClient
      .from("profiles")
      .select("id")
      .eq("is_founder_test_account", true)
      .eq("role", role)
      .maybeSingle();

    let testUserId = existing?.id as string | undefined;

    if (!testUserId) {
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email: target.email,
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: target.fullName, role },
      });
      if (createError || !created.user) {
        throw new Error(createError?.message || "Création du compte de test impossible.");
      }
      testUserId = created.user.id;

      // Laisse le trigger handle_new_user créer la ligne profiles, puis la
      // marque comme compte de test Fondateur (jamais l'inverse : un compte
      // réel ne peut jamais recevoir ce marqueur par cette fonction).
      const { error: profileError } = await adminClient
        .from("profiles")
        .update({ is_founder_test_account: true, full_name: target.fullName })
        .eq("id", testUserId);
      if (profileError) throw new Error(profileError.message);

      if (as === "structure") {
        const { error: structureError } = await adminClient.from("structures").insert({
          owner_id: testUserId,
          name: `🧪 ${target.fullName}`,
          founder_bypass: true,
          verification_status: "founder_bypass",
          verification_method: "founder",
          is_ess: false,
        });
        if (structureError) throw new Error(structureError.message);
      }
    } else if (as === "structure") {
      // Compte deja provisionne mais sans structure (cas improbable, garde-fou).
      const { data: existingStructure } = await adminClient
        .from("structures")
        .select("id")
        .eq("owner_id", testUserId)
        .maybeSingle();
      if (!existingStructure) {
        const { error: structureError } = await adminClient.from("structures").insert({
          owner_id: testUserId,
          name: `🧪 ${target.fullName}`,
          founder_bypass: true,
          verification_status: "founder_bypass",
          verification_method: "founder",
          is_ess: false,
        });
        if (structureError) throw new Error(structureError.message);
      }
    }

    const { data: link, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: target.email,
    });
    if (linkError || !link) throw new Error(linkError?.message || "Génération du lien de bascule impossible.");

    const tokenHash = link.properties?.hashed_token;
    if (!tokenHash) throw new Error("Jeton de bascule introuvable dans la réponse Supabase.");

    return json({ token_hash: tokenHash });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erreur inconnue." }, 500);
  }
});
