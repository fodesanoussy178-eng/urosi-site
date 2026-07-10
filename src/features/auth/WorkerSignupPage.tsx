import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { Fld } from '@/components/ui/Fld';
import { T, FONT, inp } from '@/components/ui/theme';
import { signUp } from './authService';
import { AuthTabs, type AuthMode } from './AuthTabs';
import { SignInForm } from './SignInForm';

export function WorkerSignupPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<AuthMode>('signup');
  const [f, setF] = useState({ prenom: '', nom: '', email: '', tel: '', ville: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ok =
    f.prenom.trim().length >= 2 &&
    f.nom.trim().length >= 1 &&
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
        fullName: `${f.prenom.trim()} ${f.nom.trim()}`.trim(),
        role: 'worker',
        city: f.ville.trim() || undefined,
        phone: f.tel.trim() || undefined,
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
          <span style={{ fontWeight: 900, fontSize: 15, color: T.text }}>{mode === 'signin' ? 'Connexion' : 'Créer mon compte'}</span>
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
          <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5, marginBottom: 16 }}>
            Juste l'essentiel pour commencer. Pas de pièce d'identité ni d'IBAN maintenant — on te les demandera seulement quand tu accepteras ta première mission payée.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Fld label="Prénom">
                <input aria-label="Prénom" value={f.prenom} onChange={(e) => setF((x) => ({ ...x, prenom: e.target.value }))} placeholder="Fodé" style={inp} autoFocus />
              </Fld>
            </div>
            <div style={{ flex: 1 }}>
              <Fld label="Nom">
                <input aria-label="Nom" value={f.nom} onChange={(e) => setF((x) => ({ ...x, nom: e.target.value }))} placeholder="D." style={inp} />
              </Fld>
            </div>
          </div>
          <Fld label="Email">
            <input aria-label="Email" value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} placeholder="toi@email.com" style={inp} inputMode="email" type="email" />
          </Fld>
          <Fld label="Mot de passe">
            <input aria-label="Mot de passe" value={f.password} onChange={(e) => setF((x) => ({ ...x, password: e.target.value }))} placeholder="6 caractères minimum" style={inp} type="password" />
          </Fld>
          <Fld label="Numéro de téléphone (optionnel)">
            <input aria-label="Téléphone" value={f.tel} onChange={(e) => setF((x) => ({ ...x, tel: e.target.value }))} placeholder="06 12 34 56 78" style={inp} inputMode="tel" />
          </Fld>
          <Fld label="Ville">
            <input aria-label="Ville" value={f.ville} onChange={(e) => setF((x) => ({ ...x, ville: e.target.value }))} placeholder="Tourcoing" style={inp} />
          </Fld>
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
            En créant ton compte, tu acceptes les CGU et la politique RGPD d'UROSI. Tu pourras supprimer ton compte à tout moment.
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
