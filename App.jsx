import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  Check,
  Clock3,
  LogOut,
  Send,
  ShieldCheck,
  Star,
  User,
} from "lucide-react";
import { hasSupabaseConfig, supabase } from "./lib/supabase";

const DURATIONS = [
  { value: "hours", label: "Quelques heures" },
  { value: "1_day", label: "1 jour" },
  { value: "2_days", label: "2 jours" },
  { value: "3_days", label: "3 jours" },
];

const STRUCTURE_TYPES = [
  { value: "association", label: "Association" },
  { value: "entreprise", label: "Entreprise" },
  { value: "collectivite", label: "Collectivite" },
  { value: "etablissement", label: "Etablissement" },
];

const BADGES = {
  verified: "Verifiee",
  pending: "En attente",
  rejected: "Refusee",
};

const PENDING_PROFILE_KEY = "urosi.pendingProfile";

const emptyWorker = {
  email: "",
  password: "",
  firstName: "",
  lastName: "",
  birthDate: "",
  address: "",
  city: "",
  postalCode: "",
  phone: "",
};

const emptyStructure = {
  email: "",
  password: "",
  firstName: "",
  lastName: "",
  phone: "",
  name: "",
  type: "association",
  siren: "",
  siret: "",
  address: "",
  city: "",
  postalCode: "",
};

const emptyMission = {
  title: "",
  description: "",
  address: "",
  city: "",
  postalCode: "",
  startsAt: "",
  duration: "hours",
  hourlyRate: "14",
};

function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [authView, setAuthView] = useState("login");
  const [setupRole, setSetupRole] = useState("worker");
  const [workerForm, setWorkerForm] = useState(emptyWorker);
  const [structureForm, setStructureForm] = useState(emptyStructure);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [missionForm, setMissionForm] = useState(emptyMission);
  const [profile, setProfile] = useState(null);
  const [userRow, setUserRow] = useState(null);
  const [structures, setStructures] = useState([]);
  const [missions, setMissions] = useState([]);
  const [applications, setApplications] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        await loadAccount(data.session.user).catch((error) => setNotice(error.message || "Profil introuvable."));
      }
      setBooting(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        loadAccount(nextSession.user).catch((error) => setNotice(error.message || "Profil introuvable."));
      }
      if (!nextSession) {
        setProfile(null);
        setUserRow(null);
        setStructures([]);
        setApplications([]);
        setMissions([]);
        setReviews([]);
        setAuthView("login");
        setSetupRole("worker");
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user && profile) {
      loadMarket().catch((error) => setNotice(error.message || "Chargement impossible."));
    }
  }, [session?.user?.id, profile?.role]);

  async function run(action, successMessage) {
    setLoading(true);
    setNotice("");
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (error) {
      setNotice(error.message || "Action impossible pour le moment.");
    } finally {
      setLoading(false);
    }
  }

  function handleExistingAccountError(error, email) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("already") || message.includes("registered") || message.includes("exists")) {
      clearPendingProfile(email);
      setLoginForm({ email, password: "" });
      setAuthView("login");
      error.message = "Ce compte existe deja. Connecte-toi avec cet email, pas besoin de te reinscrire.";
    }
  }

  async function loadAccount(authUser) {
    const userId = authUser.id;
    await ensureProfileExists(authUser);

    const [{ data: nextProfile }, { data: nextUser }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("users").select("*").eq("id", userId).maybeSingle(),
    ]);
    if (!nextProfile) {
      setProfile(null);
      setUserRow(nextUser);
      setStructures([]);
      const metadata = normalizeProfileData(authUser.user_metadata);
      if (metadata.role === "structure" || metadata.role === "worker") setSetupRole(metadata.role);
      setNotice("Compte connecte. Complete le profil UROSI une seule fois, sans recreer de compte.");
      return;
    }

    setProfile(nextProfile);
    setUserRow(nextUser);
    setSetupRole(nextProfile.role === "structure" ? "structure" : "worker");

    if (nextProfile?.role === "structure") {
      const { data } = await supabase
        .from("structures")
        .select("*")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false });
      setStructures(data || []);
    } else {
      setStructures([]);
    }
  }

  async function ensureProfileExists(authUser) {
    const metadata = normalizeProfileData({
      ...authUser.user_metadata,
      ...readPendingProfile(authUser.email),
    });

    await upsertUserRow(authUser, metadata.phone);

    const { data: existingProfile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle();
    if (error) throw error;

    if (!existingProfile && metadata.role) {
      if (metadata.role === "structure") {
        await createStructureProfile(authUser, metadata, { skipLoad: true, skipVerify: true });
      } else {
        await createWorkerProfile(authUser, metadata, { skipLoad: true });
      }
      clearPendingProfile(authUser.email);
      return;
    }

    if (existingProfile) {
      const missingProfileData = {};
      ["first_name", "last_name", "phone", "address", "city", "postal_code"].forEach((field) => {
        if (!existingProfile[field] && metadata[field]) missingProfileData[field] = metadata[field];
      });
      if (!existingProfile.birth_date && metadata.birth_date) missingProfileData.birth_date = metadata.birth_date;

      if (Object.keys(missingProfileData).length) {
        const { error: updateError } = await supabase
          .from("profiles")
          .update(missingProfileData)
          .eq("id", authUser.id);
        if (updateError) throw updateError;
      }
      clearPendingProfile(authUser.email);
    }
  }

  async function loadMarket() {
    const missionSelect = profile?.role === "structure" ? "*, structures(*)" : "*";
    const { data: missionRows, error: missionError } = await supabase
      .from("missions")
      .select(missionSelect)
      .order("created_at", { ascending: false });
    if (missionError) throw missionError;
    setMissions(missionRows || []);

    const applicationSelect = profile?.role === "structure"
      ? "*, missions(*), profiles!applications_worker_id_fkey(*)"
      : "*, missions(*)";
    const { data: applicationRows } = await supabase
      .from("applications")
      .select(applicationSelect)
      .order("created_at", { ascending: false });
    setApplications(applicationRows || []);

    const { data: reviewRows } = await supabase
      .from("reviews")
      .select("*")
      .order("created_at", { ascending: false });
    setReviews(reviewRows || []);
  }

  async function signUpWorker() {
    const { email, password } = workerForm;
    const metadata = workerProfileData(workerForm);
    savePendingProfile(email, metadata);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata },
    });
    if (error) {
      handleExistingAccountError(error, email);
      throw error;
    }
    if (!data.session?.user) {
      setNotice("Compte cree. Verifie ton email : ton profil UROSI sera recupere a la connexion.");
      setAuthView("login");
      return;
    }
    await createWorkerProfile(data.session.user, metadata);
  }

  async function createWorkerProfile(user, form, options = {}) {
    const profileData = workerProfileData(form);
    await upsertUserRow(user, profileData.phone);
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      role: "worker",
      first_name: profileData.first_name,
      last_name: profileData.last_name,
      birth_date: profileData.birth_date || null,
      address: profileData.address,
      city: profileData.city,
      postal_code: profileData.postal_code,
      phone: profileData.phone,
      kyc_level: 1,
    }, { onConflict: "id" });
    if (error) throw error;
    clearPendingProfile(user.email);
    if (!options.skipLoad) await loadAccount(user);
  }

  async function signUpStructure() {
    const { email, password } = structureForm;
    const metadata = structureProfileData(structureForm);
    savePendingProfile(email, metadata);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata },
    });
    if (error) {
      handleExistingAccountError(error, email);
      throw error;
    }
    if (!data.session?.user) {
      setNotice("Compte cree. Verifie ton email : ton profil structure sera recupere a la connexion.");
      setAuthView("login");
      return;
    }
    await createStructureProfile(data.session.user, metadata);
  }

  async function createStructureProfile(user, form, options = {}) {
    const profileData = structureProfileData(form);
    const cleanSiren = profileData.siren.replace(/\D/g, "");
    const cleanSiret = profileData.siret.replace(/\D/g, "");
    if (cleanSiren.length !== 9 || cleanSiret.length !== 14) {
      throw new Error("Le SIREN doit avoir 9 chiffres et le SIRET 14 chiffres.");
    }

    await upsertUserRow(user, profileData.phone);
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: user.id,
      role: "structure",
      first_name: profileData.first_name,
      last_name: profileData.last_name,
      address: profileData.address,
      city: profileData.city,
      postal_code: profileData.postal_code,
      phone: profileData.phone,
      kyc_level: 1,
    }, { onConflict: "id" });
    if (profileError) throw profileError;

    const { data: existingStructure, error: lookupError } = await supabase
      .from("structures")
      .select("*")
      .eq("owner_id", user.id)
      .eq("siret", cleanSiret)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existingStructure) {
      const { error: updateStructureError } = await supabase
        .from("structures")
        .update({
          name: profileData.structure_name,
          structure_type: profileData.structure_type,
          siren: cleanSiren,
          siret: cleanSiret,
          address: profileData.address,
          city: profileData.city,
          postal_code: profileData.postal_code,
          phone: profileData.phone,
          verification_status: existingStructure.verification_status || "pending",
        })
        .eq("id", existingStructure.id);
      if (updateStructureError) throw updateStructureError;
      clearPendingProfile(user.email);
      if (!options.skipLoad) await loadAccount(user);
      return;
    }

    const { data: createdStructure, error: structureError } = await supabase
      .from("structures")
      .insert({
        owner_id: user.id,
        name: profileData.structure_name,
        structure_type: profileData.structure_type,
        siren: cleanSiren,
        siret: cleanSiret,
        address: profileData.address,
        city: profileData.city,
        postal_code: profileData.postal_code,
        phone: profileData.phone,
        verification_status: "pending",
      })
      .select()
      .single();
    if (structureError) throw structureError;

    if (!options.skipVerify) await verifyStructure(createdStructure);
    clearPendingProfile(user.email);
    if (!options.skipLoad) await loadAccount(user);
  }

  async function verifyStructure(structure) {
    const { error } = await supabase.functions.invoke("verify-structure", {
      body: {
        structureId: structure.id,
        name: structure.name,
        address: structure.address,
        siret: structure.siret,
        siren: structure.siren,
      },
    });
    if (error) {
      await supabase
        .from("structures")
        .update({
          verification_status: "pending",
          verification_notes: "Verification serveur a deployer.",
        })
        .eq("id", structure.id);
    }
  }

  async function login() {
    const { data, error } = await supabase.auth.signInWithPassword(loginForm);
    if (error) throw error;
    if (data.user) await loadAccount(data.user);
  }

  async function logout() {
    await supabase.auth.signOut();
    setAuthView("login");
  }

  async function publishMission() {
    const structure = structures[0];
    if (!structure) throw new Error("Cree d'abord une structure.");
    if (structure.verification_status === "rejected") {
      throw new Error("Une structure refusee ne peut pas publier de mission.");
    }
    const { title, description, address, city, postalCode, startsAt, duration, hourlyRate } = missionForm;
    const totalAmount = duration === "hours"
      ? Math.round(Number(hourlyRate || 0) * 100 * 5)
      : Math.round(Number(hourlyRate || 0) * 100 * 7 * Number(duration[0]));

    const { data: mission, error } = await supabase
      .from("missions")
      .insert({
        structure_id: structure.id,
        title,
        description,
        address,
        city,
        postal_code: postalCode,
        starts_at: startsAt || null,
        duration,
        hourly_rate_cents: Math.round(Number(hourlyRate || 0) * 100),
        total_amount_cents: totalAmount,
        status: "published",
      })
      .select()
      .single();
    if (error) throw error;

    await supabase.from("mission_events").insert({
      mission_id: mission.id,
      actor_id: session.user.id,
      event_type: "published",
      payload: { title, duration },
    });
    setMissionForm(emptyMission);
    await loadMarket();
  }

  async function applyToMission(mission) {
    if (profile?.role !== "worker") throw new Error("Connecte un compte worker pour candidater.");
    const { error } = await supabase.from("applications").insert({
      mission_id: mission.id,
      worker_id: session.user.id,
      status: "pending",
      message: "Disponible pour cette mission courte UROSI.",
    });
    if (error) throw error;
    await supabase.from("mission_events").insert({
      mission_id: mission.id,
      actor_id: session.user.id,
      event_type: "applied",
      payload: {},
    });
    await loadMarket();
  }

  async function updateApplication(application, status) {
    const { error } = await supabase
      .from("applications")
      .update({ status })
      .eq("id", application.id);
    if (error) throw error;

    await supabase.from("mission_events").insert({
      mission_id: application.mission_id,
      actor_id: session.user.id,
      event_type: status === "accepted" ? "accepted" : "rejected",
      payload: { application_id: application.id },
    });
    await loadMarket();
  }

  async function reviewMission(application, rating, hasIssue = false) {
    const isStructure = profile?.role === "structure";
    const target = isStructure
      ? { worker_id: application.worker_id }
      : { structure_id: application.missions.structure_id };

    const { error } = await supabase.from("reviews").insert({
      mission_id: application.mission_id,
      reviewer_id: session.user.id,
      rating,
      has_issue: hasIssue,
      issue_reason: hasIssue ? "Manquement signale" : null,
      comment: hasIssue ? "Signalement a traiter par UROSI." : "Mission terminee.",
      ...target,
    });
    if (error) throw error;
    await loadMarket();
  }

  const structure = structures[0];
  const myApplicationIds = useMemo(
    () => new Set(applications.filter((item) => item.worker_id === session?.user?.id).map((item) => item.mission_id)),
    [applications, session?.user?.id],
  );

  if (!hasSupabaseConfig) {
    return (
      <main className="shell">
        <section className="panel setup">
          <ShieldCheck />
          <h1>UROSI App</h1>
          <p>Ajoute les variables Supabase publiques dans `.env.local` pour activer l'app.</p>
          <code>VITE_SUPABASE_URL</code>
          <code>VITE_SUPABASE_ANON_KEY</code>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="brand">UROSI</span>
          <p>Missions courtes, de quelques heures a 3 jours maximum.</p>
        </div>
        {session ? (
          <button className="ghost" onClick={() => run(logout)}>
            <LogOut size={16} /> Sortir
          </button>
        ) : null}
      </header>

      {notice ? <div className="notice">{notice}</div> : null}

      {booting ? (
        <section className="panel setup">
          <ShieldCheck />
          <h1>UROSI</h1>
          <p>Chargement du compte.</p>
        </section>
      ) : !session ? (
        <AuthPanel
          authView={authView}
          setAuthView={setAuthView}
          workerForm={workerForm}
          setWorkerForm={setWorkerForm}
          structureForm={structureForm}
          setStructureForm={setStructureForm}
          loginForm={loginForm}
          setLoginForm={setLoginForm}
          loading={loading}
          onWorker={() => run(signUpWorker)}
          onStructure={() => run(signUpStructure)}
          onLogin={() => run(login)}
        />
      ) : !profile ? (
        <SetupPanel
          setupRole={setupRole}
          setSetupRole={setSetupRole}
          workerForm={workerForm}
          setWorkerForm={setWorkerForm}
          structureForm={structureForm}
          setStructureForm={setStructureForm}
          loading={loading}
          onWorker={() => run(() => createWorkerProfile(session.user, workerForm), "Profil worker active.")}
          onStructure={() => run(() => createStructureProfile(session.user, structureForm), "Structure creee et verification lancee.")}
          onLogout={() => run(logout)}
        />
      ) : (
        <div className="grid">
          <section className="panel">
            <AccountCard profile={profile} userRow={userRow} structure={structure} />
          </section>

          {profile.role === "structure" ? (
            <StructureDesk
              structure={structure}
              missionForm={missionForm}
              setMissionForm={setMissionForm}
              missions={missions}
              applications={applications}
              reviews={reviews}
              loading={loading}
              onPublish={() => run(publishMission, "Mission publiee. Elle apparait maintenant cote worker.")}
              onAccept={(app) => run(() => updateApplication(app, "accepted"))}
              onReject={(app) => run(() => updateApplication(app, "rejected"))}
              onReview={(app, rating, hasIssue) => run(() => reviewMission(app, rating, hasIssue))}
            />
          ) : (
            <WorkerDesk
              missions={missions}
              applications={applications}
              reviews={reviews}
              currentUserId={session.user.id}
              myApplicationIds={myApplicationIds}
              loading={loading}
              onApply={(mission) => run(() => applyToMission(mission), "Candidature envoyee a la structure.")}
              onReview={(app, rating, hasIssue) => run(() => reviewMission(app, rating, hasIssue))}
            />
          )}
        </div>
      )}
    </main>
  );
}

function AuthPanel(props) {
  const {
    authView,
    setAuthView,
    workerForm,
    setWorkerForm,
    structureForm,
    setStructureForm,
    loginForm,
    setLoginForm,
    loading,
    onWorker,
    onStructure,
    onLogin,
  } = props;

  const isLogin = authView === "login";
  const isWorkerSignup = authView === "worker";

  return (
    <section className="auth-grid">
      <div className="panel intro">
        <h1>Entrer dans UROSI</h1>
        <p>Connexion, compte worker et compte structure sont separes. Chaque compte charge ensuite son vrai profil Supabase.</p>
        <div className="switches">
          <button className={authView === "login" ? "active" : ""} onClick={() => setAuthView("login")}>
            <Check size={16} /> Connexion
          </button>
          <button className={authView === "worker" ? "active" : ""} onClick={() => setAuthView("worker")}>
            <User size={16} /> Creer un compte worker
          </button>
          <button className={authView === "structure" ? "active" : ""} onClick={() => setAuthView("structure")}>
            <Building2 size={16} /> Creer un compte structure
          </button>
        </div>
      </div>

      <div className="panel">
        {isLogin ? (
          <form onSubmit={(event) => { event.preventDefault(); onLogin(); }}>
            <h2>Connexion</h2>
            <Input label="Email" value={loginForm.email} onChange={(email) => setLoginForm({ ...loginForm, email })} type="email" />
            <Input label="Mot de passe" value={loginForm.password} onChange={(password) => setLoginForm({ ...loginForm, password })} type="password" />
            <button className="primary" disabled={loading}><Check size={16} /> Se connecter</button>
            <div className="auth-links">
              <button type="button" onClick={() => setAuthView("worker")}><User size={16} /> Creer un compte worker</button>
              <button type="button" onClick={() => setAuthView("structure")}><Building2 size={16} /> Creer un compte structure</button>
            </div>
          </form>
        ) : isWorkerSignup ? (
          <form onSubmit={(event) => { event.preventDefault(); onWorker(); }}>
            <h2>Inscription worker</h2>
            <button type="button" className="ghost auth-return" onClick={() => setAuthView("login")}>Deja un compte ? Se connecter</button>
            <div className="two">
              <Input label="Prenom" value={workerForm.firstName} onChange={(firstName) => setWorkerForm({ ...workerForm, firstName })} />
              <Input label="Nom" value={workerForm.lastName} onChange={(lastName) => setWorkerForm({ ...workerForm, lastName })} />
            </div>
            <Input label="Date de naissance" value={workerForm.birthDate} onChange={(birthDate) => setWorkerForm({ ...workerForm, birthDate })} type="date" />
            <Input label="Adresse" value={workerForm.address} onChange={(address) => setWorkerForm({ ...workerForm, address })} />
            <div className="two">
              <Input label="Ville" value={workerForm.city} onChange={(city) => setWorkerForm({ ...workerForm, city })} />
              <Input label="Code postal" value={workerForm.postalCode} onChange={(postalCode) => setWorkerForm({ ...workerForm, postalCode })} />
            </div>
            <Input label="Telephone" value={workerForm.phone} onChange={(phone) => setWorkerForm({ ...workerForm, phone })} />
            <Input label="Email" value={workerForm.email} onChange={(email) => setWorkerForm({ ...workerForm, email })} type="email" />
            <Input label="Mot de passe" value={workerForm.password} onChange={(password) => setWorkerForm({ ...workerForm, password })} type="password" />
            <button className="primary" disabled={loading}><Check size={16} /> Creer le compte</button>
            <button type="button" className="ghost" onClick={() => setAuthView("login")}>Deja un compte ? Se connecter</button>
          </form>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); onStructure(); }}>
            <h2>Inscription structure</h2>
            <button type="button" className="ghost auth-return" onClick={() => setAuthView("login")}>Deja un compte ? Se connecter</button>
            <div className="two">
              <Input label="Prenom contact" value={structureForm.firstName} onChange={(firstName) => setStructureForm({ ...structureForm, firstName })} />
              <Input label="Nom contact" value={structureForm.lastName} onChange={(lastName) => setStructureForm({ ...structureForm, lastName })} />
            </div>
            <Input label="Nom structure" value={structureForm.name} onChange={(name) => setStructureForm({ ...structureForm, name })} />
            <label>
              Type
              <select value={structureForm.type} onChange={(event) => setStructureForm({ ...structureForm, type: event.target.value })}>
                {STRUCTURE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <div className="two">
              <Input label="SIREN" value={structureForm.siren} onChange={(siren) => setStructureForm({ ...structureForm, siren })} />
              <Input label="SIRET" value={structureForm.siret} onChange={(siret) => setStructureForm({ ...structureForm, siret })} />
            </div>
            <Input label="Adresse declaree" value={structureForm.address} onChange={(address) => setStructureForm({ ...structureForm, address })} />
            <div className="two">
              <Input label="Ville" value={structureForm.city} onChange={(city) => setStructureForm({ ...structureForm, city })} />
              <Input label="Code postal" value={structureForm.postalCode} onChange={(postalCode) => setStructureForm({ ...structureForm, postalCode })} />
            </div>
            <Input label="Telephone" value={structureForm.phone} onChange={(phone) => setStructureForm({ ...structureForm, phone })} />
            <Input label="Email" value={structureForm.email} onChange={(email) => setStructureForm({ ...structureForm, email })} type="email" />
            <Input label="Mot de passe" value={structureForm.password} onChange={(password) => setStructureForm({ ...structureForm, password })} type="password" />
            <button className="primary" disabled={loading}><ShieldCheck size={16} /> Verifier et creer</button>
            <button type="button" className="ghost" onClick={() => setAuthView("login")}>Deja un compte ? Se connecter</button>
          </form>
        )}
      </div>
    </section>
  );
}

function SetupPanel({
  setupRole,
  setSetupRole,
  workerForm,
  setWorkerForm,
  structureForm,
  setStructureForm,
  loading,
  onWorker,
  onStructure,
  onLogout,
}) {
  const isWorker = setupRole === "worker";

  return (
    <section className="auth-grid">
      <div className="panel intro">
        <h1>Compte retrouve</h1>
        <p>Ton email est connecte. Complete seulement le profil manquant, sans recreer de compte.</p>
        <div className="switches">
          <button className={isWorker ? "active" : ""} onClick={() => setSetupRole("worker")}>
            <User size={16} /> Worker
          </button>
          <button className={!isWorker ? "active" : ""} onClick={() => setSetupRole("structure")}>
            <Building2 size={16} /> Structure
          </button>
        </div>
        <button className="ghost" onClick={onLogout}><LogOut size={16} /> Revenir a la connexion</button>
      </div>

      <div className="panel">
        {isWorker ? (
          <form onSubmit={(event) => { event.preventDefault(); onWorker(); }}>
            <h2>Profil worker</h2>
            <div className="two">
              <Input label="Prenom" value={workerForm.firstName} onChange={(firstName) => setWorkerForm({ ...workerForm, firstName })} />
              <Input label="Nom" value={workerForm.lastName} onChange={(lastName) => setWorkerForm({ ...workerForm, lastName })} />
            </div>
            <Input label="Date de naissance" value={workerForm.birthDate} onChange={(birthDate) => setWorkerForm({ ...workerForm, birthDate })} type="date" />
            <Input label="Adresse" value={workerForm.address} onChange={(address) => setWorkerForm({ ...workerForm, address })} />
            <div className="two">
              <Input label="Ville" value={workerForm.city} onChange={(city) => setWorkerForm({ ...workerForm, city })} />
              <Input label="Code postal" value={workerForm.postalCode} onChange={(postalCode) => setWorkerForm({ ...workerForm, postalCode })} />
            </div>
            <Input label="Telephone" value={workerForm.phone} onChange={(phone) => setWorkerForm({ ...workerForm, phone })} />
            <button className="primary" disabled={loading}><Check size={16} /> Activer worker</button>
          </form>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); onStructure(); }}>
            <h2>Profil structure</h2>
            <div className="two">
              <Input label="Prenom contact" value={structureForm.firstName} onChange={(firstName) => setStructureForm({ ...structureForm, firstName })} />
              <Input label="Nom contact" value={structureForm.lastName} onChange={(lastName) => setStructureForm({ ...structureForm, lastName })} />
            </div>
            <Input label="Nom structure" value={structureForm.name} onChange={(name) => setStructureForm({ ...structureForm, name })} />
            <label>
              Type
              <select value={structureForm.type} onChange={(event) => setStructureForm({ ...structureForm, type: event.target.value })}>
                {STRUCTURE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <div className="two">
              <Input label="SIREN" value={structureForm.siren} onChange={(siren) => setStructureForm({ ...structureForm, siren })} />
              <Input label="SIRET" value={structureForm.siret} onChange={(siret) => setStructureForm({ ...structureForm, siret })} />
            </div>
            <Input label="Adresse declaree" value={structureForm.address} onChange={(address) => setStructureForm({ ...structureForm, address })} />
            <div className="two">
              <Input label="Ville" value={structureForm.city} onChange={(city) => setStructureForm({ ...structureForm, city })} />
              <Input label="Code postal" value={structureForm.postalCode} onChange={(postalCode) => setStructureForm({ ...structureForm, postalCode })} />
            </div>
            <Input label="Telephone" value={structureForm.phone} onChange={(phone) => setStructureForm({ ...structureForm, phone })} />
            <button className="primary" disabled={loading}><ShieldCheck size={16} /> Activer structure</button>
          </form>
        )}
      </div>
    </section>
  );
}

function AccountCard({ profile, userRow, structure }) {
  const isStructure = profile.role === "structure";
  const status = structure?.verification_status || "pending";
  const profileName = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();

  return (
    <div className="account">
      <div className="avatar">{isStructure ? <Building2 /> : <User />}</div>
      <div>
        <h2>{isStructure ? structure?.name || profileName || "Structure" : profileName || "Worker"}</h2>
        <p>{isStructure && profileName ? `${profileName} - ${userRow?.email || ""}` : userRow?.email}</p>
        <div className="chips">
          <span><Check size={14} /> Email {userRow?.email_verified ? "verifie" : "a verifier"}</span>
          <span><Clock3 size={14} /> Telephone {userRow?.phone_verified ? "verifie" : "a verifier"}</span>
          {isStructure ? <span className={status}><BadgeCheck size={14} /> {BADGES[status]}</span> : null}
          {!isStructure ? <span><ShieldCheck size={14} /> Niveau KYC {profile.kyc_level}</span> : null}
        </div>
      </div>
    </div>
  );
}

function StructureDesk(props) {
  const {
    structure,
    missionForm,
    setMissionForm,
    missions,
    applications,
    reviews,
    loading,
    onPublish,
    onAccept,
    onReject,
    onReview,
  } = props;

  const ownedMissions = missions.filter((mission) => mission.structure_id === structure?.id);
  const incoming = applications.filter((item) => item.missions?.structure_id === structure?.id);

  return (
    <>
      <section className="panel">
        <h2>Publier une mission</h2>
        <p className="muted">Quelques heures, 1 jour, 2 jours ou 3 jours. Aucune mission superieure a 3 jours.</p>
        <form onSubmit={(event) => { event.preventDefault(); onPublish(); }}>
          <Input label="Titre" value={missionForm.title} onChange={(title) => setMissionForm({ ...missionForm, title })} />
          <Textarea label="Details" value={missionForm.description} onChange={(description) => setMissionForm({ ...missionForm, description })} />
          <Input label="Adresse" value={missionForm.address} onChange={(address) => setMissionForm({ ...missionForm, address })} />
          <div className="two">
            <Input label="Ville" value={missionForm.city} onChange={(city) => setMissionForm({ ...missionForm, city })} />
            <Input label="Code postal" value={missionForm.postalCode} onChange={(postalCode) => setMissionForm({ ...missionForm, postalCode })} />
          </div>
          <div className="two">
            <Input label="Debut" type="datetime-local" value={missionForm.startsAt} onChange={(startsAt) => setMissionForm({ ...missionForm, startsAt })} />
            <label>
              Duree
              <select value={missionForm.duration} onChange={(event) => setMissionForm({ ...missionForm, duration: event.target.value })}>
                {DURATIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </div>
          <Input label="Taux horaire indicatif" value={missionForm.hourlyRate} onChange={(hourlyRate) => setMissionForm({ ...missionForm, hourlyRate })} type="number" />
          <button className="primary" disabled={loading || !structure}><Send size={16} /> Publier</button>
        </form>
      </section>

      <section className="panel">
        <h2>Missions publiees</h2>
        <div className="list">
          {ownedMissions.map((mission) => <MissionCard key={mission.id} mission={mission} />)}
          {!ownedMissions.length ? <p className="empty">Aucune mission publiee.</p> : null}
        </div>
      </section>

      <section className="panel wide">
        <h2>Candidatures worker</h2>
        <div className="list">
          {incoming.map((application) => (
            <ApplicationCard
              key={application.id}
              application={application}
              reviews={reviews}
              side="structure"
              onAccept={() => onAccept(application)}
              onReject={() => onReject(application)}
              onReview={(rating, issue) => onReview(application, rating, issue)}
            />
          ))}
          {!incoming.length ? <p className="empty">Aucune candidature pour le moment.</p> : null}
        </div>
      </section>
    </>
  );
}

function WorkerDesk({ missions, applications, reviews, currentUserId, myApplicationIds, loading, onApply, onReview }) {
  const openMissions = missions.filter((mission) => mission.status === "published");
  const myApplications = applications.filter((item) => item.worker_id === currentUserId);

  return (
    <>
      <section className="panel wide">
        <h2>Flux missions</h2>
        <div className="list cards">
          {openMissions.map((mission) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              action={
                <button className="primary" disabled={loading || myApplicationIds.has(mission.id)} onClick={() => onApply(mission)}>
                  <Send size={16} /> {myApplicationIds.has(mission.id) ? "Envoyee" : "Candidater"}
                </button>
              }
            />
          ))}
          {!openMissions.length ? <p className="empty">Aucune mission publiee pour le moment.</p> : null}
        </div>
      </section>

      <section className="panel wide">
        <h2>Mes candidatures</h2>
        <div className="list">
          {myApplications.map((application) => (
            <ApplicationCard
              key={application.id}
              application={application}
              reviews={reviews}
              side="worker"
              onReview={(rating, issue) => onReview(application, rating, issue)}
            />
          ))}
          {!myApplications.length ? <p className="empty">Aucune candidature envoyee.</p> : null}
        </div>
      </section>
    </>
  );
}

function MissionCard({ mission, action }) {
  const structureName = mission.structures?.name || "Structure UROSI";

  return (
    <article className="item">
      <div>
        <h3>{mission.title}</h3>
        <p>{structureName} - {mission.city || mission.address}</p>
        <div className="chips">
          <span><Clock3 size={14} /> {DURATIONS.find((item) => item.value === mission.duration)?.label}</span>
          <span>{money(mission.hourly_rate_cents)} / h</span>
          <span>{mission.status}</span>
        </div>
      </div>
      {action}
    </article>
  );
}

function ApplicationCard({ application, reviews, side, onAccept, onReject, onReview }) {
  const worker = application.profiles;
  const workerReviews = reviews.filter((review) => review.worker_id === application.worker_id && review.rating);
  const avg = workerReviews.length
    ? workerReviews.reduce((sum, review) => sum + review.rating, 0) / workerReviews.length
    : null;

  return (
    <article className="item stacked">
      <div className="split">
        <div>
          <h3>{application.missions?.title}</h3>
          <p>{side === "structure" ? `${worker?.first_name || "Worker"} ${worker?.last_name || ""}` : application.missions?.structures?.name || "Structure UROSI"}</p>
        </div>
        <strong className={`status ${application.status}`}>{application.status}</strong>
      </div>

      {side === "structure" ? (
        <div className="profile-line">
          <span>{worker?.city || "Ville non renseignee"}</span>
          <span>KYC niveau {worker?.kyc_level || 1}</span>
          <span>{avg ? `★ ${avg.toFixed(1)}` : "★ Nouveau"}</span>
        </div>
      ) : null}

      <div className="actions">
        {side === "structure" && application.status === "pending" ? (
          <>
            <button onClick={onAccept}><Check size={16} /> Accepter</button>
            <button className="danger" onClick={onReject}><AlertTriangle size={16} /> Refuser</button>
          </>
        ) : null}
        {application.status === "accepted" ? <Stars onRate={(rating) => onReview(rating, false)} /> : null}
        {application.status === "accepted" ? <button className="small danger" onClick={() => onReview(1, true)}>Manquement / signaler</button> : null}
      </div>
    </article>
  );
}

function Stars({ onRate }) {
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map((rating) => (
        <button key={rating} title={`${rating} etoile${rating > 1 ? "s" : ""}`} onClick={() => onRate(rating)}>
          <Star size={18} fill="currentColor" />
        </button>
      ))}
    </div>
  );
}

function Input({ label, value, onChange, type = "text" }) {
  return (
    <label>
      {label}
      <input required value={value} type={type} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Textarea({ label, value, onChange }) {
  return (
    <label>
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function money(cents) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format((cents || 0) / 100);
}

async function upsertUserRow(user, phone) {
  const { error } = await supabase.from("users").upsert({
    id: user.id,
    email: user.email,
    phone: phone || user.phone || "",
    email_verified: Boolean(user.email_confirmed_at),
    phone_verified: Boolean(user.phone_confirmed_at),
  }, { onConflict: "id" });
  if (error) throw error;
}

function workerProfileData(source) {
  const normalized = normalizeProfileData(source);
  return {
    role: "worker",
    first_name: normalized.first_name,
    last_name: normalized.last_name,
    birth_date: normalized.birth_date,
    address: normalized.address,
    city: normalized.city,
    postal_code: normalized.postal_code,
    phone: normalized.phone,
  };
}

function structureProfileData(source) {
  const normalized = normalizeProfileData(source);
  return {
    role: "structure",
    first_name: normalized.first_name,
    last_name: normalized.last_name,
    phone: normalized.phone,
    structure_name: normalized.structure_name,
    structure_type: normalized.structure_type,
    siren: normalized.siren,
    siret: normalized.siret,
    address: normalized.address,
    city: normalized.city,
    postal_code: normalized.postal_code,
  };
}

function normalizeProfileData(source = {}) {
  const role = source.role === "structure" ? "structure" : source.role === "worker" ? "worker" : "";
  return {
    role,
    first_name: valueFrom(source, "firstName", "first_name"),
    last_name: valueFrom(source, "lastName", "last_name"),
    birth_date: valueFrom(source, "birthDate", "birth_date"),
    address: valueFrom(source, "address"),
    city: valueFrom(source, "city"),
    postal_code: valueFrom(source, "postalCode", "postal_code"),
    phone: valueFrom(source, "phone"),
    structure_name: valueFrom(source, "name", "structure_name"),
    structure_type: valueFrom(source, "type", "structure_type") || "association",
    siren: valueFrom(source, "siren").replace(/\D/g, ""),
    siret: valueFrom(source, "siret").replace(/\D/g, ""),
  };
}

function valueFrom(source, camelKey, snakeKey = camelKey) {
  return String(source?.[camelKey] ?? source?.[snakeKey] ?? "").trim();
}

function savePendingProfile(email, profileData) {
  if (!email) return;
  window.localStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify({
    email: email.toLowerCase(),
    profile: profileData,
  }));
}

function readPendingProfile(email) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PENDING_PROFILE_KEY) || "null");
    if (!stored?.profile) return {};
    if (email && stored.email !== email.toLowerCase()) return {};
    return stored.profile;
  } catch {
    return {};
  }
}

function clearPendingProfile(email) {
  const stored = readPendingProfile(email);
  if (Object.keys(stored).length) window.localStorage.removeItem(PENDING_PROFILE_KEY);
}

export default App;
