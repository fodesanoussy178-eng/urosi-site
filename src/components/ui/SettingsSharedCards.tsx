// Blocs partagés entre les écrans Réglages Worker et Structure : compte
// (email/mot de passe) et suppression de compte sont identiques quel que
// soit le rôle, pas la peine de les dupliquer.
import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { T, inp } from './theme';
import { Fld } from './Fld';
import { updateEmail, updatePassword } from '@/features/auth/authService';
import { requestAccountDeletion } from '@/features/profile/profileService';
import { describeError } from '@/lib/errors';

export function SectionTitle({ children }: { children: string }) {
  return <div style={{ fontSize: 10, fontWeight: 800, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.6, margin: '18px 2px 8px' }}>{children}</div>;
}

export function AccountCard({ session, notif }: { session: Session; notif: (m: string) => void }) {
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [editingPassword, setEditingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveEmail() {
    if (!newEmail.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateEmail(newEmail.trim());
      setEditingEmail(false);
      setNewEmail('');
      notif('Vérifie ta boîte mail pour confirmer ta nouvelle adresse.');
    } catch (e) {
      setError(describeError(e, "le changement d'adresse email"));
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (busy) return;
    setError(null);
    if (newPassword.length < 8) {
      setError('8 caractères minimum.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    try {
      await updatePassword(newPassword);
      setEditingPassword(false);
      setNewPassword('');
      setConfirmPassword('');
      notif('Mot de passe mis à jour ✓');
    } catch (e) {
      setError(describeError(e, 'la mise à jour du mot de passe'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span style={{ color: T.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.user.email}</span>
        {session.user.email_confirmed_at ? (
          <span style={{ fontSize: 9, fontWeight: 800, color: T.green, background: T.greenBg, borderRadius: 10, padding: '2px 8px', flexShrink: 0 }}>✓ Vérifié</span>
        ) : (
          <span style={{ fontSize: 9, fontWeight: 800, color: T.amber, background: T.amberBg, borderRadius: 10, padding: '2px 8px', flexShrink: 0 }}>À confirmer</span>
        )}
      </div>
      {!editingEmail ? (
        <button onClick={() => setEditingEmail(true)} style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.cyan, fontWeight: 700, padding: 0 }}>
          Changer d'adresse email
        </button>
      ) : (
        <div style={{ marginTop: 10 }}>
          <Fld label="Nouvelle adresse email">
            <input aria-label="Nouvelle adresse email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" style={inp} />
          </Fld>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={saveEmail} disabled={busy} style={{ flex: 1, background: '#fff', color: '#000', border: 'none', borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              Confirmer
            </button>
            <button onClick={() => { setEditingEmail(false); setNewEmail(''); setError(null); }} style={{ flex: 1, background: T.row, color: T.sub, border: 'none', borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      <div style={{ borderTop: `1px solid ${T.cb}`, margin: '13px 0' }} />

      {!editingPassword ? (
        <button onClick={() => setEditingPassword(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.cyan, fontWeight: 700, padding: 0 }}>
          Changer de mot de passe
        </button>
      ) : (
        <div>
          <Fld label="Nouveau mot de passe (8 caractères min.)">
            <input aria-label="Nouveau mot de passe" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" style={inp} />
          </Fld>
          <Fld label="Confirme le mot de passe">
            <input aria-label="Confirmation du mot de passe" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type="password" style={inp} />
          </Fld>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={savePassword} disabled={busy} style={{ flex: 1, background: '#fff', color: '#000', border: 'none', borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              Confirmer
            </button>
            <button onClick={() => { setEditingPassword(false); setNewPassword(''); setConfirmPassword(''); setError(null); }} style={{ flex: 1, background: T.row, color: T.sub, border: 'none', borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: T.red, marginTop: 10 }}>{error}</div>}
    </div>
  );
}

export function DeleteAccountCard({ notif }: { notif: (m: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (busy) return;
    setBusy(true);
    try {
      await requestAccountDeletion(reason.trim() || undefined);
      setSent(true);
      notif('Demande de suppression enregistrée.');
    } catch (e) {
      notif(describeError(e, "l'envoi de ta demande de suppression"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 14, padding: 15 }}>
      <div style={{ fontSize: 12, fontWeight: 900, color: T.red, marginBottom: 6 }}>Supprimer mon compte</div>
      {sent ? (
        <div style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>
          ✓ Ta demande a été enregistrée. Elle sera traitée par le support UROSI sous quelques jours ouvrés.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.55, marginBottom: 10 }}>
            Cette demande sera transmise au support UROSI pour traitement — ton compte n'est pas supprimé instantanément.
          </div>
          {!confirming ? (
            <button onClick={() => setConfirming(true)} style={{ background: 'none', border: `1px solid ${T.redBorder}`, color: T.red, borderRadius: 8, padding: '9px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              Demander la suppression
            </button>
          ) : (
            <>
              <textarea
                aria-label="Raison (facultatif)"
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 280))}
                rows={2}
                placeholder="Raison (facultatif)…"
                style={{ ...inp, resize: 'none', lineHeight: 1.5, marginBottom: 10 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={send} disabled={busy} style={{ flex: 1, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                  {busy ? '…' : 'Confirmer la demande'}
                </button>
                <button onClick={() => setConfirming(false)} style={{ flex: 1, background: T.row, color: T.sub, border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Annuler
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
