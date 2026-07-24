import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { T, FONT, inp } from '@/components/ui/theme';
import { AideRegles, DocModal, type DocKey } from '@/components/ui/DocModal';
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary';
import { SectionTitle, AccountCard, DeleteAccountCard } from '@/components/ui/SettingsSharedCards';
import { useBodyScrollLock } from '@/components/ui/useBodyScrollLock';
import { signOut } from '@/features/auth/authService';
import { updateProfile, type Profile } from '@/features/profile/profileService';
import type { Structure } from '@/features/missions/types';

type ProfileUpdate = Parameters<typeof updateProfile>[1];

function verificationLabel(structure: Structure | null): { label: string; color: string; bg: string } {
  if (!structure) return { label: '—', color: T.mu, bg: T.row };
  if (structure.verification_status === 'founder_bypass' || structure.founder_bypass) return { label: 'Accès fondateur', color: T.green, bg: T.greenBg };
  if (structure.verification_status === 'verified') return { label: '✓ SIRET vérifié', color: T.green, bg: T.greenBg };
  if (structure.verification_status === 'rejected') return { label: 'SIRET refusé', color: T.red, bg: T.redBg };
  return { label: 'Vérification SIRET en cours', color: T.amber, bg: T.amberBg };
}

function StructureIdentityCard({
  structure,
  profile,
  onSave,
}: {
  structure: Structure | null;
  profile: Profile | null;
  onSave: (updates: ProfileUpdate) => Promise<void>;
}) {
  const [city, setCity] = useState(profile?.city ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [address, setAddress] = useState(profile?.address ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [busy, setBusy] = useState(false);
  const badge = verificationLabel(structure);

  async function save() {
    setBusy(true);
    try {
      await onSave({
        city: city.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        bio: bio.trim() || null,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5 }}>Raison sociale</div>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: T.text, overflowWrap: 'anywhere' }}>{structure?.name ?? '—'}</div>
        </div>
        <span style={{ fontSize: 9, fontWeight: 800, color: badge.color, background: badge.bg, borderRadius: 10, padding: '3px 9px', flexShrink: 0 }}>{badge.label}</span>
      </div>
      {structure?.siret && (
        <div style={{ fontSize: 10.5, color: T.mu, marginBottom: 14 }}>
          SIRET : <span style={{ color: T.sub, fontWeight: 700 }}>{structure.siret}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Ville</div>
          <input aria-label="Ville" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lille" style={{ ...inp, marginBottom: 0 }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Téléphone</div>
          <input aria-label="Téléphone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01 23 45 67 89" inputMode="tel" style={{ ...inp, marginBottom: 0 }} />
        </div>
      </div>

      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Adresse</div>
      <input
        aria-label="Adresse"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="1 rue Exemple, 59000 Lille"
        style={{ ...inp, marginBottom: 12 }}
      />

      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Contact (usage interne)</div>
      <textarea
        aria-label="Notes de contact"
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        rows={2}
        placeholder="Personne à contacter, précisions utiles…"
        style={{ ...inp, resize: 'none', lineHeight: 1.5, marginBottom: 14 }}
      />

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

export function StructureSettingsSheet({
  session,
  profile,
  structure,
  onClose,
  onProfileSaved,
}: {
  session: Session;
  profile: Profile | null;
  structure: Structure | null;
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
        <SectionErrorBoundary label="Identité">
          <StructureIdentityCard
            structure={structure}
            profile={profile}
            onSave={async (updates) => {
              await updateProfile(session.user.id, updates);
              await onProfileSaved();
              notif('Coordonnées mises à jour ✓');
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

        <SectionTitle>Documents légaux</SectionTitle>
        <SectionErrorBoundary label="Documents légaux">
          <AideRegles onOpen={setDocKey} />
        </SectionErrorBoundary>

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
