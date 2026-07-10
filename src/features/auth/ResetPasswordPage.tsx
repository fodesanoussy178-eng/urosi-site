import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { Fld } from '@/components/ui/Fld';
import { T, FONT, inp } from '@/components/ui/theme';
import { useAuth } from './AuthContext';
import { updatePassword } from './authService';

// Page cible du lien "mot de passe oublié" : Supabase ouvre une session de
// recuperation (detectSessionInUrl), l'utilisateur choisit un nouveau mot de
// passe puis repart sur son tableau de bord.
export function ResetPasswordPage() {
  const nav = useNavigate();
  const { session } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setError(null);
    if (password.length < 8) {
      setError('8 caractères minimum.');
      return;
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de mettre à jour le mot de passe.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT, padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', margin: '18px 0 20px' }}>
          <Logo sz={54} />
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 17 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: T.text, marginBottom: 6 }}>Nouveau mot de passe</div>
          {!session && !done && (
            <div style={{ fontSize: 11, color: T.amber, lineHeight: 1.5, marginBottom: 12 }}>
              Lien expiré ou invalide. Redemande un email depuis « Mot de passe oublié » sur la page de connexion.
            </div>
          )}
          {done ? (
            <>
              <div style={{ fontSize: 12, color: T.green, lineHeight: 1.5, marginBottom: 14 }}>✓ Mot de passe mis à jour. Tu es connecté·e.</div>
              <button
                onClick={() => nav('/', { replace: true })}
                style={{ width: '100%', background: '#fff', color: '#000', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: 'pointer' }}
              >
                Aller à mon tableau de bord →
              </button>
            </>
          ) : (
            <>
              <Fld label="Nouveau mot de passe (8 caractères min.)">
                <input
                  aria-label="Nouveau mot de passe"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={inp}
                  type="password"
                />
              </Fld>
              <Fld label="Confirme le mot de passe">
                <input
                  aria-label="Confirmation"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  style={inp}
                  type="password"
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
              </Fld>
              {error && <div style={{ fontSize: 12, color: T.red, marginBottom: 10 }}>{error}</div>}
              <button
                onClick={submit}
                disabled={busy || !session}
                style={{ width: '100%', background: busy || !session ? T.row : '#fff', color: busy || !session ? T.mu : '#000', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: busy || !session ? 'not-allowed' : 'pointer', marginTop: 4 }}
              >
                {busy ? '…' : 'Enregistrer le nouveau mot de passe'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
