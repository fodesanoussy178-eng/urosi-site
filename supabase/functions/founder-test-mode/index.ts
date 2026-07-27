import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Comptes de test dedies, jamais de vrais utilisateurs : le mode Fondateur
// n'usurpe QUE des comptes de ce domaine, crees a la demande (un ou
// plusieurs par role). Toutes les valeurs sont fictives et clairement
// identifiables comme telles. Domaine @urosi.internal reserve
// exclusivement aux comptes de test — les RPC founder_mark_test_account /
// founder_provision_test_structure refusent d'agir sur tout autre domaine
// (voir migration 20260724180012_founder_test_account_provisioning_rpcs.sql).
const FAKE_SIRET = "12345678900015"; // format valide (Luhn), aucune entreprise reelle

const TEST_ACCOUNT_TEMPLATES = {
  worker: {
    fullName: "Camille Testeur",
    profile: {
      p_city: "Lille",
      p_phone: "+33600000001",
      p_bio: "Compte de test Fondateur — jamais un vrai utilisateur, jamais de vraie mission.",
      p_skills: ["service", "caisse", "manutention"],
    },
  },
  structure: {
    fullName: "Fondateur Test (compte structure)",
    structureName: "Bistrot Fictif Test SARL",
    profile: {
      p_city: "Lille",
      p_phone: "+33600000002",
      p_bio: "Compte propriétaire de test — usage interne Fondateur uniquement.",
      p_address: "1 rue Fictive, 59000 Lille",
    },
    // Profil officiel entierement fictif : simule le resultat d'une vraie
    // verification SIRET sans jamais appeler le registre. Coherent avec
    // apply_structure_siret_verification (structure_type/is_association
    // derives de legal_category_code, jamais un choix manuel).
    official: {
      p_siren: "123456789",
      p_trade_name: "Bistrot Fictif",
      p_naf_code: "56.10A",
      p_naf_label: "Restauration traditionnelle",
      p_legal_form: "SARL",
      p_postal_code: "59000",
      p_city: "Lille",
      p_address: "1 rue Fictive",
      p_established_at: "2018-03-12",
      p_structure_type: "entreprise",
      p_legal_category_code: "5499",
      p_is_association: false,
    },
  },
} as const;

type Role = "worker" | "structure";
type Mode = "create" | "switch";

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
// quand createUser echoue avec "deja enregistre" (collision improbable sur
// le suffixe aleatoire) pour ne jamais retenter une creation en boucle.
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

// Cree TOUJOURS un nouveau compte de test (email suffixe aleatoire) : le
// Fondateur peut ainsi avoir plusieurs profils/structures de test au lieu
// d'un seul figé.
async function createNewTestUser(
  adminClient: ReturnType<typeof createClient>,
  as: Role,
): Promise<string> {
  const template = TEST_ACCOUNT_TEMPLATES[as];
  const role = as === "structure" ? "structure_admin" : "worker";
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const email = `founder-test-${as}-${suffix}@urosi.internal`;

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { full_name: template.fullName, role },
  });
  if (created?.user) return created.user.id;

  if (isAlreadyRegisteredError(createError?.message)) {
    const recoveredId = await findAuthUserByEmail(adminClient, email);
    if (recoveredId) return recoveredId;
  }

  throw new Error(createError?.message || "Création du compte de test impossible.");
}

// Bascule vers un compte de test deja cree : verifie qu'il existe bien et
// correspond au role demande avant d'agir dessus. Passe par la RPC
// founder_resolve_test_account (session du fondateur), le meme chemin deja
// utilise avec succes par founder_test_accounts_list — plutot qu'une
// requete PostgREST brute via la cle service_role, qui echouait en
// production sans raison identifiee.
async function resolveExistingTestUserId(
  callerClient: ReturnType<typeof createClient>,
  as: Role,
  accountId: string,
): Promise<string> {
  const { data, error } = await callerClient.rpc("founder_resolve_test_account", {
    p_account_id: accountId,
    p_as: as,
  });
  if (error) throw new Error(`Compte de test introuvable (erreur technique : ${error.message}).`);
  if (!data) throw new Error("Compte de test introuvable.");
  return data as string;
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
    // peut faire : creer/retrouver un compte auth et generer un lien de bascule.
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
    const mode: Mode = body?.mode === "create" ? "create" : "switch";
    const accountId = typeof body?.account_id === "string" ? body.account_id : undefined;

    if (as !== "worker" && as !== "structure") {
      return json({ error: "Paramètre 'as' invalide : 'worker' ou 'structure' attendu." }, 400);
    }
    if (mode === "switch" && !accountId) {
      return json({ error: "account_id requis pour basculer vers un compte existant." }, 400);
    }

    const template = TEST_ACCOUNT_TEMPLATES[as as Role];
    const testUserId =
      mode === "create"
        ? await createNewTestUser(adminClient, as as Role)
        : await resolveExistingTestUserId(callerClient, as as Role, accountId!);

    const { error: markError } = await callerClient.rpc("founder_mark_test_account", {
      p_user_id: testUserId,
      p_full_name: template.fullName,
      ...template.profile,
    });
    if (markError) throw new Error(markError.message);

    if (as === "structure") {
      const { data: testStructure, error: structureError } = await callerClient.rpc("founder_provision_test_structure", {
        p_owner_id: testUserId,
        p_name: TEST_ACCOUNT_TEMPLATES.structure.structureName,
        p_siret: FAKE_SIRET,
        p_about: "Structure fictive dédiée aux tests internes Fondateur. Jamais une vraie entreprise.",
        ...TEST_ACCOUNT_TEMPLATES.structure.official,
      });
      if (structureError) throw new Error(structureError.message);

      // Une mission ouverte deja disponible : pas besoin de publier a la main
      // avant de pouvoir tester candidatures/QR/paiement/historique.
      if (testStructure?.id) {
        const { error: missionError } = await callerClient.rpc("founder_provision_test_mission", {
          p_structure_id: testStructure.id,
        });
        if (missionError) throw new Error(missionError.message);
      }
    }

    const { data: userRecord, error: userError } = await adminClient.auth.admin.getUserById(testUserId);
    if (userError || !userRecord?.user?.email) {
      throw new Error(userError?.message || "Compte de test introuvable côté authentification.");
    }

    const { data: link, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: userRecord.user.email,
    });
    if (linkError || !link) throw new Error(linkError?.message || "Génération du lien de bascule impossible.");

    const tokenHash = link.properties?.hashed_token;
    if (!tokenHash) throw new Error("Jeton de bascule introuvable dans la réponse Supabase.");

    return json({ token_hash: tokenHash });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erreur inconnue." }, 500);
  }
});
