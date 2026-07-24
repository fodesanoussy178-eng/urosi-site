import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { T, FONT, inp } from '@/components/ui/theme';
import { Fld } from '@/components/ui/Fld';
import { AideRegles, DocModal, type DocKey } from '@/components/ui/DocModal';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { useBodyScrollLock } from '@/components/ui/useBodyScrollLock';
import { signOut, updateEmail, updatePassword } from '@/features/auth/authService';
import { requestAccountDeletion, updateProfile, type Profile } from '@/features/profile/profileService';

import { describeError } from '@/lib/errors';

type ProfileUpdate = Parameters<typeof updateProfile>[1];

function SectionTitle({ children }: { children: string }) {
  return <div style={{ fontSize: 10, fontWeight: 800, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.6, margin: '18px 2px 8px' }}>{children}</div>;
}

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || '';
}

function lastNamePartOf(fullName: string): string {
  return fullName.trim().split(/\s+/).slice(1).join(' ');
}

function IdentityCard({ profile, onSave }: { profile: Profile | null; onSave: (updates: ProfileUpdate) => Promise<void> }) {
  const fullName = profile?.full_name ?? '';
  const [legalName, setLegalName] = useState(fullName);
  const [publicFirstName, setPublicFirstName] = useState(profile?.public_first_name ?? '');
  const [showLastName, setShowLastName] = useState(profile?.show_last_name ?? false);
  const [city, setCity] = useState(profile?.city ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [skillsText, setSkillsText] = useState((profile?.skills ?? []).join(', '));
  const [micro, setMicro] = useState(profile?.is_micro_entrepreneur ?? false);
  const [busy, setBusy] = useState(false);

  const effectiveFirstName = publicFirstName.trim() || firstNameOf(legalName);
  const lastPart = lastNamePartOf(legalName);
  const preview = showLastName && lastPart ? `${effectiveFirstName} ${lastPart}` : effectiveFirstName || 'Travailleur';

  async function save() {
    setBusy(true);
    try {
      await onSave({
        full_name: legalName,
        public_first_name: publicFirstName.trim() || null,
        show_last_name: showLastName,
        is_micro_entrepreneur: micro,
        city: city.trim() || null,
        phone: phone.trim() || null,
        bio: bio.trim() || null,
        skills: skillsText.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Prénom affiché</div>
      <input
        aria-label="Prénom affiché"
        value={publicFirstName}
        onChange={(e) => setPublicFirstName(e.target.value)}
        placeholder={firstNameOf(legalName) || 'Ton prénom'}
        style={{ ...inp, marginBottom: 10 }}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={showLastName} onChange={(e) => setShowLastName(e.target.checked)} style={{ width: 16, height: 16 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Afficher mon nom de famille aux structures</span>
      </label>
      <div style={{ fontSize: 10.5, color: T.mu, lineHeight: 1.5, marginBottom: 14 }}>
        Les structures verront : <strong style={{ color: T.sub }}>{preview}</strong>. Ton prénom leur est toujours visible ; le nom de famille reste masqué tant que cette case n'est pas cochée.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Ville</div>
          <input aria-label="Ville" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lille" style={{ ...inp, marginBottom: 0 }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Téléphone</div>
          <input aria-label="Téléphone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 12 34 56 78" inputMode="tel" style={{ ...inp, marginBottom: 0 }} />
        </div>
      </div>

      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Bio (visible sur ton CV vivant)</div>
      <textarea
        aria-label="Bio"
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        rows={2}
        placeholder="En deux mots, qui tu es et ce que tu cherches…"
        style={{ ...inp, resize: 'none', lineHeight: 1.5, marginBottom: 12 }}
      />

      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Compétences (séparées par des virgules)</div>
      <input
        aria-label="Compétences"
        value={skillsText}
        onChange={(e) => setSkillsText(e.target.value)}
        placeholder="service, caisse, manutention…"
        style={{ ...inp, marginBottom: 12 }}
      />

      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Statut</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
        <button onClick={() => setMicro(false)} style={{ background: !micro ? '#fff' : T.row, color: !micro ? '#000' : T.sub, border: `1px solid ${!micro ? '#fff' : T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
          Particulier
        </button>
        <button onClick={() => setMicro(true)} style={{ background: micro ? '#fff' : T.row, color: micro ? '#000' : T.sub, border: `1px solid ${micro ? '#fff' : T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
          Micro-entrepreneur
        </button>
      </div>

      <details style={{ marginBottom: 14 }}>
        <summary style={{ fontSize: 10.5, fontWeight: 800, color: T.mu, cursor: 'pointer' }}>Nom légal complet (usage interne : KYC, paiement, conformité)</summary>
        <div style={{ marginTop: 8 }}>
          <input aria-label="Nom légal complet" value={legalName} onChange={(e) => setLegalName(e.target.value)} style={{ ...inp, marginBottom: 6 }} />
          <div style={{ fontSize: 9.5, color: T.mu, lineHeight: 1.5 }}>Utilisé uniquement pour la vérification d'identité et le paiement — jamais montré aux structures.</div>
        </div>
      </details>

      <button
        onClick={save}
        disabled={busy}
        style={{ width: '100%', background: busy ? T.row : '#fff', color: busy ? T.mu : '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer' }}
      >
        {busy ? '…' : 'Enregistrer'}
      </button>
    </div>
  );
}

function AccountCard({ session, notif }: { session: Session; notif: (m: string) => void }) {
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

function DeleteAccountCard({ notif }: { notif: (m: string) => void }) {
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

export function WorkerSettingsSheet({
  session,
  profile,
  onClose,
  onProfileSaved,
}: {
  session: Session;
  profile: Profile | null;
  onClose: () => void;
  onProfileSaved: () => Promise<void>;
}) {
  useBodyScrollLock(true);
  const [docKey, setDocKey] = useState<DocKey | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function notif(m: string) {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="urosi-modal-layer" role="dialog" aria-modal="true" aria-label="Réglages" style={{ position: 'fixed', inset: 0, background: T.bg, zIndex: 1300, display: 'flex', justifyContent: 'center', overflowY: 'auto', fontFamily: FONT }}>
      <div style={{ width: '100%', maxWidth: 430, padding: 'calc(16px + env(safe-area-inset-top)) 14px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: T.text }}>Réglages</div>
          <button onClick={onClose} aria-label="Fermer les réglages" style={{ background: T.row, border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: T.sub, fontSize: 15 }}>×</button>
        </div>

        {toast && <div style={{ marginBottom: 12, background: T.card, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '8px 11px', fontSize: 11, color: T.sub }}>{toast}</div>}

        <SectionTitle>Identité</SectionTitle>
        <IdentityCard
          profile={profile}
          onSave={async (updates) => {
            await updateProfile(session.user.id, updates);
            await onProfileSaved();
            notif('Profil mis à jour ✓');
          }}
        />

        <SectionTitle>Compte</SectionTitle>
        <AccountCard session={session} notif={notif} />

        <SectionTitle>Notifications</SectionTitle>
        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.4 }}>Consulter, marquer comme lues, archiver ou supprimer tes notifications.</span>
          <NotificationBell profileId={session.user.id} onDataChanged={() => undefined} />
        </div>

        <SectionTitle>Documents légaux</SectionTitle>
        <AideRegles onOpen={setDocKey} />

        <SectionTitle>Session</SectionTitle>
        <button
          onClick={() => signOut()}
          style={{ width: '100%', textAlign: 'left', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, cursor: 'pointer', padding: '13px 15px', fontSize: 12.5, color: T.text, fontWeight: 700 }}
        >
          Se déconnecter
        </button>

        <SectionTitle>Zone sensible</SectionTitle>
        <DeleteAccountCard notif={notif} />

        {docKey && <DocModal dk={docKey} onClose={() => setDocKey(null)} />}
      </div>
    </div>
  );
}
