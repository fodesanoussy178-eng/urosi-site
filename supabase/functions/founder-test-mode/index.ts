import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Comptes de test dedies, jamais de vrais utilisateurs : le mode Fondateur
// n'usurpe QUE ces deux identites, creees/reutilisees ici a la demande.
// Toutes les valeurs sont fictives et clairement identifiables comme telles.
// Domaine @urosi.internal reserve exclusivement aux comptes de test — les
// RPC founder_mark_test_account / founder_provision_test_structure
// refusent d'agir sur tout autre domaine (voir migration
// 20260724180000_founder_test_account_provisioning_rpcs.sql).
const FAKE_SIRET = "12345678900015"; // format valide (Luhn), aucune entreprise reelle

const TEST_ACCOUNTS = {
  worker: {
    email: "founder-test-worker@urosi.internal",
    fullName: "Camille Testeur",
    profile: {
      p_city: "Lille",
      p_phone: "+33600000001",
      p_bio: "Compte de test Fondateur — jamais un vrai utilisateur, jamais de vraie mission.",
      p_skills: ["service", "caisse", "manutention"],
    },
  },
  structure: {
    email: "founder-test-structure@urosi.internal",
    fullName: "Fondateur Test (compte structure)",
    structureName: "Bistrot Fictif Test SARL",
    profile: {
      p_city: "Lille",
      p_phone: "+33600000002",
      p_bio: "Compte propriétaire de test — usage interne Fondateur uniquement.",
      p_address: "1 rue Fictive, 59000 Lille",
    },
  },
} as const;

type Role = "worker" | "structure";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAlreadyRegisteredError(message: string | undefined): boolean {
  return /already.*registered|already exists|email_exists/i.test(message ?? "");
}

// Retrouve un utilisateur auth existant par email. Repli utilise uniquement
// quand createUser echoue avec "deja enregistre" mais que le flag
// is_founder_test_account n'a, pour une raison quelconque (echec partiel
// d'un appel precedent, appels concurrents), jamais ete pose — pour ne
// JAMAIS retenter une creation en boucle sur le meme email.
async function findAuthUserByEmail(
  adminClient: ReturnType<typeof createClient>,
  email: string,
): Promise<string | undefined> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return undefined;
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (found) return found.id;
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

async function ensureTestUserId(
  adminClient: ReturnType<typeof createClient>,
  as: Role,
): Promise<string> {
  const target = TEST_ACCOUNTS[as];
  const role = as === "structure" ? "structure_admin" : "worker";

  const { data: existing } = await adminClient
    .from("profiles")
    .select("id")
    .eq("is_founder_test_account", true)
    .eq("role", role)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email: target.email,
    password: crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { full_name: target.fullName, role },
  });

  if (created?.user) return created.user.id;

  if (isAlreadyRegisteredError(createError?.message)) {
    const recoveredId = await findAuthUserByEmail(adminClient, target.email);
    if (recoveredId) return recoveredId;
  }

  throw new Error(createError?.message || "Création du compte de test impossible.");
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
    // callerClient porte le VRAI jeton du fondateur : les RPC sensibles
    // (founder_mark_test_account, founder_provision_test_structure)
    // s'executent avec cette identite, jamais avec la cle service_role —
    // is_founder() n'a de sens que pour une vraie session utilisateur.
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    // adminClient (service_role) sert UNIQUEMENT a ce que seule l'API admin
    // peut faire : creer un compte auth et generer un lien de bascule.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // verify_jwt est desactive au niveau de la passerelle pour cette fonction :
    // on verifie nous-memes le jeton ici via un appel reel a GoTrue
    // (auth.getUser), l'autorite qui l'a emis — plus fiable qu'une
    // verification de signature au niveau de la passerelle, qui peut echouer
    // (« unrecognized JWT kid ... ») si la rotation des cles de signature du
    // projet n'est pas encore repercutee a ce niveau-la.
    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Non authentifié." }, 401);

    const { data: isFounder, error: founderError } = await callerClient.rpc("has_founder_access");
    if (founderError || !isFounder) return json({ error: "Accès Fondateur requis." }, 403);

    const body = await req.json().catch(() => ({}));
    const as = body?.as;
    if (as !== "worker" && as !== "structure") {
      return json({ error: "Paramètre 'as' invalide : 'worker' ou 'structure' attendu." }, 400);
    }

    const target = TEST_ACCOUNTS[as as Role];
    const testUserId = await ensureTestUserId(adminClient, as);

    const { error: markError } = await callerClient.rpc("founder_mark_test_account", {
      p_user_id: testUserId,
      p_full_name: target.fullName,
      ...target.profile,
    });
    if (markError) throw new Error(markError.message);

    if (as === "structure") {
      const { error: structureError } = await callerClient.rpc("founder_provision_test_structure", {
        p_owner_id: testUserId,
        p_name: TEST_ACCOUNTS.structure.structureName,
        p_siret: FAKE_SIRET,
        p_about: "Structure fictive dédiée aux tests internes Fondateur. Jamais une vraie entreprise.",
      });
      if (structureError) throw new Error(structureError.message);
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
