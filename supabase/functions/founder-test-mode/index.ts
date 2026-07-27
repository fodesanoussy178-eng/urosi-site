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

// Un nouveau compte de test travailleur pioche un prenom dans ce pool
// (au lieu de toujours "Camille Testeur") — le Fondateur peut aussi le
// renommer ensuite depuis le Centre Fondateur (founder_rename_test_account).
const WORKER_NAME_POOL = [
  "Camille Testeur",
  "Thomas Testeur",
  "Léa Testeur",
  "Nora Testeur",
  "Yanis Testeur",
  "Chloé Testeur",
] as const;

const WORKER_PROFILE_TEMPLATE = {
  p_city: "Lille",
  p_phone: "+33600000001",
  p_bio: "Compte de test Fondateur — jamais un vrai utilisateur, jamais de vraie mission.",
  p_skills: ["service", "caisse", "manutention"],
};

const STRUCTURE_OWNER_FULL_NAME = "Fondateur Test (compte structure)";

// Un nouveau compte de test structure pioche parmi plusieurs profils
// realistes (commerce classique, association/ESS, services...) plutot que
// toujours le meme "Bistrot Fictif" — chaque profil officiel est
// entierement fictif et coherent avec apply_structure_siret_verification
// (structure_type/is_ess derives de legal_category_code cote reel ; ici
// poses directement puisque founder_provision_test_structure ne relance
// pas cette derivation). SIRET Luhn-valides mais tous sequentiels/fictifs.
const STRUCTURE_TEMPLATES = [
  {
    structureName: "Bistrot Fictif Test SARL",
    siret: "12345678900015",
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
  {
    structureName: "Épicerie Solidaire des Tanneurs",
    siret: "23456789000111",
    official: {
      p_siren: "234567890",
      p_trade_name: "Épicerie Solidaire des Tanneurs",
      p_naf_code: "88.99B",
      p_naf_label: "Action sociale sans hébergement n.c.a.",
      p_legal_form: "Association loi 1901",
      p_postal_code: "59100",
      p_city: "Roubaix",
      p_address: "12 rue des Tanneurs",
      p_established_at: "2015-09-01",
      p_structure_type: "association",
      p_legal_category_code: "9220",
      p_is_association: true,
    },
  },
  {
    structureName: "Nova Facility Services SAS",
    siret: "34567890001124",
    official: {
      p_siren: "345678900",
      p_trade_name: "Nova Facility Services",
      p_naf_code: "81.21Z",
      p_naf_label: "Nettoyage courant des bâtiments",
      p_legal_form: "SAS",
      p_postal_code: "59200",
      p_city: "Tourcoing",
      p_address: "45 avenue Fictive",
      p_established_at: "2020-01-15",
      p_structure_type: "entreprise",
      p_legal_category_code: "5710",
      p_is_association: false,
    },
  },
  {
    structureName: "Comptoir Frais SASU",
    siret: "45678900011230",
    official: {
      p_siren: "456789000",
      p_trade_name: "Comptoir Frais",
      p_naf_code: "47.11D",
      p_naf_label: "Commerce de détail de produits surgelés",
      p_legal_form: "SASU",
      p_postal_code: "59650",
      p_city: "Villeneuve-d'Ascq",
      p_address: "8 rue du Marché",
      p_established_at: "2019-06-01",
      p_structure_type: "entreprise",
      p_legal_category_code: "5785",
      p_is_association: false,
    },
  },
] as const;

type StructureTemplate = (typeof STRUCTURE_TEMPLATES)[number];

function pickRandom<T>(pool: readonly T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

type Role = "worker" | "structure";
type Mode = "create" | "switch" | "delete";

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
  fullName: string,
): Promise<string> {
  const role = as === "structure" ? "structure_admin" : "worker";
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const email = `founder-test-${as}-${suffix}@urosi.internal`;

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
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
    const mode: Mode = body?.mode === "create" ? "create" : body?.mode === "delete" ? "delete" : "switch";
    const accountId = typeof body?.account_id === "string" ? body.account_id : undefined;
    const pairedStructureId = typeof body?.paired_structure_id === "string" ? body.paired_structure_id : undefined;
    const isSolidaireMission = body?.is_solidaire === true;

    if (as !== "worker" && as !== "structure") {
      return json({ error: "Paramètre 'as' invalide : 'worker' ou 'structure' attendu." }, 400);
    }
    if ((mode === "switch" || mode === "delete") && !accountId) {
      return json({ error: "account_id requis pour cette opération." }, 400);
    }
    if (mode === "create" && as === "worker" && !pairedStructureId) {
      return json({ error: "Choisis d'abord une structure de test à laquelle rattacher ce travailleur." }, 400);
    }

    if (mode === "delete") {
      // Verifie d'abord que le compte existe et est bien un compte de test
      // (meme garde-fou que la bascule), puis supprime le profil (cascade
      // structure/missions/etc.) et enfin le compte auth — dans cet ordre,
      // pour ne jamais laisser un profil de test orphelin si l'un des deux
      // echoue.
      const resolvedId = await resolveExistingTestUserId(callerClient, as as Role, accountId!);
      const { error: deleteProfileError } = await callerClient.rpc("founder_delete_test_account", {
        p_account_id: resolvedId,
        p_as: as,
      });
      if (deleteProfileError) throw new Error(deleteProfileError.message);
      const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(resolvedId);
      if (deleteAuthError) throw new Error(deleteAuthError.message);
      return json({ ok: true });
    }

    // Choix pioche UNE fois, avant creation : reutilise pour user_metadata,
    // founder_mark_test_account et founder_provision_test_structure sans
    // repiocher (les trois doivent decrire le meme compte).
    const chosenWorkerName = as === "worker" ? pickRandom(WORKER_NAME_POOL) : "";
    const chosenStructure: StructureTemplate | null = as === "structure" ? pickRandom(STRUCTURE_TEMPLATES) : null;

    const testUserId =
      mode === "create"
        ? await createNewTestUser(
            adminClient,
            as as Role,
            as === "structure" ? STRUCTURE_OWNER_FULL_NAME : chosenWorkerName,
          )
        : await resolveExistingTestUserId(callerClient, as as Role, accountId!);

    // founder_mark_test_account ecrase full_name sans condition (pas de
    // coalesce) : ne JAMAIS l'appeler en mode 'switch', sous peine
    // d'ecraser a chaque bascule un renommage fait depuis le Centre
    // Fondateur (founder_rename_test_account) par le nom par defaut.
    if (mode === "create") {
      const ownerProfile =
        as === "worker"
          ? WORKER_PROFILE_TEMPLATE
          : {
              p_city: chosenStructure!.official.p_city,
              p_phone: "+33600000002",
              p_bio: "Compte propriétaire de test — usage interne Fondateur uniquement.",
              p_address: chosenStructure!.official.p_address,
            };
      const { error: markError } = await callerClient.rpc("founder_mark_test_account", {
        p_user_id: testUserId,
        p_full_name: as === "structure" ? STRUCTURE_OWNER_FULL_NAME : chosenWorkerName,
        ...ownerProfile,
        ...(as === "worker" ? { p_paired_test_structure_id: pairedStructureId } : {}),
      });
      if (markError) throw new Error(markError.message);
    }

    if (as === "structure") {
      // Idempotent des deux cotes (founder_provision_test_structure comme
      // founder_provision_test_mission renvoient l'existant sans ecraser) :
      // sans risque de repasser ici aussi en mode 'switch'.
      const struct = chosenStructure!;
      const { data: testStructure, error: structureError } = await callerClient.rpc("founder_provision_test_structure", {
        p_owner_id: testUserId,
        p_name: struct.structureName,
        p_siret: struct.siret,
        p_about: "Structure fictive dédiée aux tests internes Fondateur. Jamais une vraie entreprise.",
        ...struct.official,
      });
      if (structureError) throw new Error(structureError.message);

      // Une mission ouverte deja disponible : pas besoin de publier a la main
      // avant de pouvoir tester candidatures/QR/paiement/historique.
      if (testStructure?.id) {
        const { error: missionError } = await callerClient.rpc("founder_provision_test_mission", {
          p_structure_id: testStructure.id,
          p_is_solidaire: isSolidaireMission,
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
