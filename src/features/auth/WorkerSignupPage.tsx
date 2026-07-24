import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { Fld } from '@/components/ui/Fld';
import { T, FONT, inp } from '@/components/ui/theme';
import { signUp } from './authService';
import { describeError } from '@/lib/errors';
import { AuthTabs, type AuthMode } from './AuthTabs';
import { SignInForm } from './SignInForm';

// Inscription travailleur : uniquement l'essentiel, champs vides,
// placeholders neutres (jamais de données personnelles en exemple).
export function WorkerSignupPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<AuthMode>('signup');
  const [f, setF] = useState({ prenom: '', nom: '', email: '', ville: '', password: '', confirm: '', cgu: false });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ok =
    f.prenom.trim().length >= 2 &&
    f.nom.trim().length >= 1 &&
    /\S+@\S+\.\S+/.test(f.email) &&
    f.password.length >= 6 &&
    f.password === f.confirm &&
    f.cgu;

  async function submit() {
    if (busy) return;
    setError(null);
    if (f.password.length >= 6 && f.confirm && f.password !== f.confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    if (!ok) return;
    setBusy(true);
    try {
      const data = await signUp({
        email: f.email.trim(),
        password: f.password,
        fullName: `${f.prenom.trim()} ${f.nom.trim()}`.trim(),
        role: 'worker',
        city: f.ville.trim() || undefined,
      });
      if (!data.session) {
        setInfo('Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.');
      }
    } catch (e) {
      setError(describeError(e, 'la création du compte'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-demo-shell" style={{ fontFamily: FONT }}>
      <div className="auth-demo-layout">
        <div className="auth-form-column">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontWeight: 900, fontSize: 15, color: T.text }}>{mode === 'signin' ? 'Connexion' : 'Créer mon compte'}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => nav('/')} style={{ fontSize: 10, color: T.mu, background: 'none', border: `1px solid ${T.cb}`, borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }}>
              ← Accueil
            </button>
          </div>
        </div>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Logo sz={54} />
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 17 }}>
          <AuthTabs mode={mode} onChange={setMode} />
          {mode === 'signin' && <SignInForm />}
          {mode === 'signup' && (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <Fld label="Prénom">
                    <input aria-label="Prénom" value={f.prenom} onChange={(e) => setF((x) => ({ ...x, prenom: e.target.value }))} placeholder="Prénom" style={inp} autoFocus />
                  </Fld>
                </div>
                <div style={{ flex: 1 }}>
                  <Fld label="Nom">
                    <input aria-label="Nom" value={f.nom} onChange={(e) => setF((x) => ({ ...x, nom: e.target.value }))} placeholder="Nom" style={inp} />
                  </Fld>
                </div>
              </div>
              <Fld label="Adresse e-mail">
                <input aria-label="Email" value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} placeholder="Adresse e-mail" style={inp} inputMode="email" type="email" />
              </Fld>
              <Fld label="Mot de passe">
                <input aria-label="Mot de passe" value={f.password} onChange={(e) => setF((x) => ({ ...x, password: e.target.value }))} placeholder="Mot de passe (6 caractères min.)" style={inp} type="password" />
              </Fld>
              <Fld label="Confirmer le mot de passe">
                <input aria-label="Confirmer le mot de passe" value={f.confirm} onChange={(e) => setF((x) => ({ ...x, confirm: e.target.value }))} placeholder="Confirmer le mot de passe" style={inp} type="password" />
              </Fld>
              <Fld label="Ville">
                <input aria-label="Ville" value={f.ville} onChange={(e) => setF((x) => ({ ...x, ville: e.target.value }))} placeholder="Ville" style={inp} />
              </Fld>
              <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 12 }}>
                <input
                  type="checkbox"
                  aria-label="J'accepte les conditions d'utilisation"
                  checked={f.cgu}
                  onChange={(e) => setF((x) => ({ ...x, cgu: e.target.checked }))}
                  style={{ marginTop: 2, accentColor: '#0891b2' }}
                />
                <span style={{ fontSize: 11, color: T.sub, lineHeight: 1.5 }}>
                  J'accepte les <a href="/cgu" target="_blank" rel="noreferrer" style={{ color: T.cyan, fontWeight: 800 }}>conditions d'utilisation</a> et la <a href="/confidentialite" target="_blank" rel="noreferrer" style={{ color: T.cyan, fontWeight: 800 }}>politique de confidentialité</a> d'UROSI.
                </span>
              </label>
              {error && <div style={{ fontSize: 12, color: T.red, marginBottom: 10 }}>{error}</div>}
              {info && <div style={{ fontSize: 12, color: T.green, marginBottom: 10 }}>{info}</div>}
              <button
                onClick={submit}
                disabled={!ok || busy}
                style={{ width: '100%', background: ok && !busy ? '#fff' : T.row, color: ok && !busy ? '#000' : T.mu, border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: ok && !busy ? 'pointer' : 'not-allowed', marginTop: 4 }}
              >
                {busy ? '…' : ok ? 'Créer mon compte' : 'Remplis tes infos'}
              </button>
              <div style={{ fontSize: 9, color: T.mu, textAlign: 'center', lineHeight: 1.5, marginTop: 10 }}>
                Pas de pièce d'identité ni d'IBAN maintenant — on te les demandera seulement quand ce sera nécessaire.
              </div>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
