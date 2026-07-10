import { useState } from 'react';
import { Fld } from '@/components/ui/Fld';
import { T, inp } from '@/components/ui/theme';
import { isUnconfirmedEmailError, requestPasswordReset, resendConfirmationEmail, signIn } from './authService';

export function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setError(null);
    setInfo(null);
    setShowResend(false);
    setBusy(true);
    try {
      await signIn({ email: email.trim(), password });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur.');
      if (isUnconfirmedEmailError(e)) setShowResend(true);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await resendConfirmationEmail(email.trim());
      setInfo('Email de confirmation renvoyé ✓ — ouvre le lien reçu puis reconnecte-toi.');
      setShowResend(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    if (busy) return;
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError("Renseigne d'abord ton email, puis retape « Mot de passe oublié ».");
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setInfo('Email envoyé ✓ — ouvre le lien reçu pour choisir un nouveau mot de passe.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Fld label="Email">
        <input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="toi@email.com" style={inp} inputMode="email" type="email" />
      </Fld>
      <Fld label="Mot de passe">
        <input
          aria-label="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          style={inp}
          type="password"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </Fld>
      {error && <div style={{ fontSize: 12, color: T.red, marginBottom: 10 }}>{error}</div>}
      {info && <div style={{ fontSize: 12, color: T.green, marginBottom: 10 }}>{info}</div>}
      {showResend && (
        <button
          onClick={resend}
          style={{ width: '100%', background: T.amberBg, color: T.amber, border: `1px solid ${T.amberBorder}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer', marginBottom: 10 }}
        >
          ✉ Renvoyer l'email de confirmation
        </button>
      )}
      <button
        onClick={submit}
        disabled={busy}
        style={{ width: '100%', background: busy ? T.row : '#fff', color: busy ? T.mu : '#000', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: busy ? 'not-allowed' : 'pointer', marginTop: 4 }}
      >
        {busy ? '…' : 'Se connecter'}
      </button>
      <button
        onClick={forgotPassword}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.mu, textDecoration: 'underline', padding: '10px 0 0', fontWeight: 600 }}
      >
        Mot de passe oublié ?
      </button>
    </>
  );
}
