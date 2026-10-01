import { useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { T, FONT, inp } from '@/components/ui/theme';
import { AideRegles, DocModal, type DocKey } from '@/components/ui/DocModal';
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary';
import { SectionTitle, AccountCard, DeleteAccountCard } from '@/components/ui/SettingsSharedCards';
import { useBodyScrollLock } from '@/components/ui/useBodyScrollLock';
import { signOut } from '@/features/auth/authService';
import { updateProfile, type Profile } from '@/features/profile/profileService';
import { features } from '@/lib/features';

type ProfileUpdate = Parameters<typeof updateProfile>[1];

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
  const preview = showLastName && lastPart ? `${effectiveFirstName} ${lastPart}` : effectiveFirstName || (features.paidLayer ? 'Travailleur' : 'Participant');

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

      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Bio (visible sur ton CV)</div>
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
        placeholder={features.paidLayer ? 'service, caisse, manutention…' : 'accueil, animation, logistique…'}
        style={{ ...inp, marginBottom: 12 }}
      />

      {/* Statut professionnel : couche rémunérée uniquement (en sommeil en phase 0). */}
      {features.paidLayer && (
        <>
        <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Statut</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
          <button onClick={() => setMicro(false)} style={{ background: !micro ? '#fff' : T.row, color: !micro ? '#000' : T.sub, border: `1px solid ${!micro ? '#fff' : T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            Particulier
          </button>
          <button onClick={() => setMicro(true)} style={{ background: micro ? '#fff' : T.row, color: micro ? '#000' : T.sub, border: `1px solid ${micro ? '#fff' : T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            Micro-entrepreneur
          </button>
        </div>
        </>
      )}

      <details style={{ marginBottom: 14 }}>
        <summary style={{ fontSize: 10.5, fontWeight: 800, color: T.mu, cursor: 'pointer' }}>{features.paidLayer ? 'Nom légal complet (usage interne : KYC, paiement, conformité)' : 'Nom complet'}</summary>
        <div style={{ marginTop: 8 }}>
          <input aria-label="Nom légal complet" value={legalName} onChange={(e) => setLegalName(e.target.value)} style={{ ...inp, marginBottom: 6 }} />
          <div style={{ fontSize: 9.5, color: T.mu, lineHeight: 1.5 }}>{features.paidLayer ? "Utilisé uniquement pour la vérification d'identité et le paiement — jamais montré aux structures." : 'Ton nom de famille reste masqué aux structures, sauf si tu choisis de l’afficher.'}</div>
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

export function WorkerSettingsSheet({
  session,
  profile,
  onClose,
  onProfileSaved,
  extraTop,
}: {
  session: Session;
  profile: Profile | null;
  onClose: () => void;
  onProfileSaved: () => Promise<void>;
  // Phase 0 : photo facultative + centres d'intérêt, fournis par l'espace participant.
  extraTop?: ReactNode;
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

        {extraTop}

        <SectionTitle>Identité</SectionTitle>
        <SectionErrorBoundary label="Identité">
          <IdentityCard
            profile={profile}
            onSave={async (updates) => {
              await updateProfile(session.user.id, updates);
              await onProfileSaved();
              notif('Profil mis à jour ✓');
            }}
          />
        </SectionErrorBoundary>

        <SectionTitle>Compte</SectionTitle>
        <SectionErrorBoundary label="Compte">
          <AccountCard session={session} notif={notif} />
        </SectionErrorBoundary>

        <SectionTitle>Notifications</SectionTitle>
        <SectionErrorBoundary label="Notifications">
          {/* Pas de second abonnement temps réel ici : la cloche 🔔 de l'écran
              principal gère déjà tout (lu/archivé/supprimé). En ouvrir un
              second sur le même canal Realtime créerait un conflit. */}
          <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
            <span style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.4 }}>
              Gère tes notifications depuis la cloche 🔔 en haut de l'écran principal (marquer comme lues, archiver, supprimer).
            </span>
          </div>
        </SectionErrorBoundary>

        {features.paidLayer ? (
          <>
            <SectionTitle>Documents légaux</SectionTitle>
            <SectionErrorBoundary label="Documents légaux">
              <AideRegles onOpen={setDocKey} />
            </SectionErrorBoundary>
          </>
        ) : (
          <>
            <SectionTitle>Documents légaux</SectionTitle>
            <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
              <a href="/cgu" target="_blank" rel="noreferrer" style={{ color: T.cyan, fontWeight: 800 }}>Conditions d’utilisation</a>
              <a href="/confidentialite" target="_blank" rel="noreferrer" style={{ color: T.cyan, fontWeight: 800 }}>Confidentialité</a>
              <a href="/mentions-legales" target="_blank" rel="noreferrer" style={{ color: T.cyan, fontWeight: 800 }}>Mentions légales</a>
            </div>
          </>
        )}

        <SectionTitle>Session</SectionTitle>
        <SectionErrorBoundary label="Session">
          <button
            onClick={() => signOut()}
            style={{ width: '100%', textAlign: 'left', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, cursor: 'pointer', padding: '13px 15px', fontSize: 12.5, color: T.text, fontWeight: 700 }}
          >
            Se déconnecter
          </button>
        </SectionErrorBoundary>

        <SectionTitle>Zone sensible</SectionTitle>
        <SectionErrorBoundary label="Zone sensible">
          <DeleteAccountCard notif={notif} />
        </SectionErrorBoundary>

        {docKey && <DocModal dk={docKey} onClose={() => setDocKey(null)} />}
      </div>
    </div>
  );
}
