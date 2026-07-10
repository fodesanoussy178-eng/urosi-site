import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { Fld } from '@/components/ui/Fld';
import { T, FONT, inp } from '@/components/ui/theme';
import { signUp } from './authService';
import { AuthTabs, type AuthMode } from './AuthTabs';
import { SignInForm } from './SignInForm';

export function StructureSignupPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<AuthMode>('signup');
  const [f, setF] = useState({ nom: '', siret: '', email: '', password: '', ess: false });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ok =
    f.nom.trim().length >= 2 &&
    f.siret.replace(/\s/g, '').length >= 9 &&
    /\S+@\S+\.\S+/.test(f.email) &&
    f.password.length >= 6;

  async function submit() {
    if (!ok || busy) return;
    setError(null);
    setBusy(true);
    try {
      const data = await signUp({
        email: f.email.trim(),
        password: f.password,
        fullName: f.nom.trim(),
        role: 'structure_admin',
        structureName: f.nom.trim(),
        siret: f.siret.trim(),
        isEss: f.ess,
      });
      if (!data.session) {
        setInfo('Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT, padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontWeight: 900, fontSize: 15, color: T.text }}>Espace structure</span>
          <button onClick={() => nav('/')} style={{ fontSize: 10, color: T.mu, background: 'none', border: `1px solid ${T.cb}`, borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }}>
            ← Accueil
          </button>
        </div>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Logo sz={54} />
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 17 }}>
          <AuthTabs mode={mode} onChange={setMode} />
          {mode === 'signin' && <SignInForm />}
          {mode === 'signup' && (
            <>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 4 }}>Avant de publier, on identifie ta structure</div>
          <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5, marginBottom: 16 }}>
            Seules les structures identifiées (SIRET) peuvent publier des missions. Aucun lien de subordination n'est créé : UROSI est une plateforme de mise en relation (modèle mandataire).
          </div>
          <Fld label="Nom de la structure">
            <input aria-label="Nom de la structure" value={f.nom} onChange={(e) => setF((x) => ({ ...x, nom: e.target.value }))} placeholder="Burger Nord" style={inp} autoFocus />
          </Fld>
          <Fld label="SIRET">
            <input aria-label="SIRET" value={f.siret} onChange={(e) => setF((x) => ({ ...x, siret: e.target.value }))} placeholder="123 456 789 00012" style={inp} inputMode="numeric" />
          </Fld>
          <Fld label="Type de structure">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button type="button" onClick={() => setF((x) => ({ ...x, ess: false }))} style={{ background: !f.ess ? '#fff' : T.row, color: !f.ess ? '#000' : T.sub, border: `1px solid ${!f.ess ? '#fff' : T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                🏢 Entreprise
              </button>
              <button type="button" onClick={() => setF((x) => ({ ...x, ess: true }))} style={{ background: f.ess ? '#16a34a' : T.row, color: f.ess ? '#fff' : '#4ade80', border: `1px solid ${f.ess ? '#16a34a' : '#14532d'}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                🤝 Association (ESS)
              </button>
            </div>
            {f.ess && <div style={{ fontSize: 9.5, color: T.green, marginTop: 6, lineHeight: 1.5 }}>Les associations ESS peuvent publier des missions solidaires (bénévoles, 0 €) qui comptent dans le CV vivant des participants.</div>}
          </Fld>
          <Fld label="Email">
            <input aria-label="Email" value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} placeholder="contact@structure.fr" style={inp} inputMode="email" type="email" />
          </Fld>
          <Fld label="Mot de passe">
            <input aria-label="Mot de passe" value={f.password} onChange={(e) => setF((x) => ({ ...x, password: e.target.value }))} placeholder="6 caractères minimum" style={inp} type="password" />
          </Fld>
          {error && <div style={{ fontSize: 12, color: T.red, marginBottom: 10 }}>{error}</div>}
          {info && <div style={{ fontSize: 12, color: T.green, marginBottom: 10 }}>{info}</div>}
          <button
            onClick={submit}
            disabled={!ok || busy}
            style={{ width: '100%', background: ok && !busy ? '#fff' : T.row, color: ok && !busy ? '#000' : T.mu, border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: ok && !busy ? 'pointer' : 'not-allowed', marginTop: 4 }}
          >
            {busy ? '…' : ok ? 'Créer mon espace structure' : 'Renseigne nom, SIRET, email et mot de passe'}
          </button>
            </>
          )}
        </div>
        <div style={{ fontSize: 9, color: T.mu, textAlign: 'center', lineHeight: 1.5, marginTop: 14 }}>
          UROSI est une plateforme de mise en relation (modèle mandataire).
          <br />
          Aucun lien de subordination n'est créé.
        </div>
      </div>
    </div>
  );
}
