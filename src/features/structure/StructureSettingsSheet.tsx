import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { T, FONT, inp } from '@/components/ui/theme';
import { AideRegles, DocModal, type DocKey } from '@/components/ui/DocModal';
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary';
import { SectionTitle, AccountCard, DeleteAccountCard } from '@/components/ui/SettingsSharedCards';
import { useBodyScrollLock } from '@/components/ui/useBodyScrollLock';
import { signOut } from '@/features/auth/authService';
import { updateProfile, type Profile } from '@/features/profile/profileService';
import { submitStructureSiret, requestStructureVerification, updateStructurePresentation } from './structureService';
import { formatSiret } from './verification';
import { describeError } from '@/lib/errors';
import type { Structure } from '@/features/missions/types';

type ProfileUpdate = Parameters<typeof updateProfile>[1];

function verificationLabel(structure: Structure | null): { label: string; color: string; bg: string } {
  if (!structure) return { label: '—', color: T.mu, bg: T.row };
  if (structure.verification_status === 'founder_bypass' || structure.founder_bypass) return { label: 'Accès fondateur (test)', color: T.green, bg: T.greenBg };
  if (structure.verification_status === 'verified') return { label: '✓ Vérifiée', color: T.green, bg: T.greenBg };
  if (structure.verification_status === 'closed') return { label: 'Établissement fermé', color: T.red, bg: T.redBg };
  if (structure.verification_status === 'not_found') return { label: 'SIRET introuvable', color: T.red, bg: T.redBg };
  if (structure.verification_status === 'rejected') return { label: 'SIRET refusé', color: T.red, bg: T.redBg };
  return { label: 'À vérifier', color: T.amber, bg: T.amberBg };
}

// Fiche officielle : raison sociale, SIRET/SIREN, adresse, NAF, forme
// juridique, statut association/type — tout vient du registre, rien n'est
// modifiable ici (cf. guard_structure_verification_fields côté serveur).
function OfficialProfileCard({ structure, onReverified }: { structure: Structure | null; onReverified: () => Promise<void> }) {
  const [siretInput, setSiretInput] = useState('');
  const [editingSiret, setEditingSiret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badge = verificationLabel(structure);
  const isFounderTest = structure?.verification_method === 'founder';
  const canRetry = !isFounderTest && (structure?.verification_status === 'pending' || structure?.verification_status === 'not_found' || structure?.verification_status === 'closed');

  async function reverify(siret?: string) {
    if (!structure || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (siret) await submitStructureSiret(structure.id, siret);
      const result = await requestStructureVerification(structure.id);
      await onReverified();
      setEditingSiret(false);
      setSiretInput('');
      if (result.status !== 'verified') setError(result.message);
    } catch (e) {
      setError(describeError(e, 'la vérification du SIRET'));
    } finally {
      setBusy(false);
    }
  }

  const officialAddress = [structure?.address, structure?.postal_code, structure?.city].filter(Boolean).join(', ');

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5 }}>Raison sociale</div>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: T.text, overflowWrap: 'anywhere' }}>{structure?.name ?? '—'}</div>
        </div>
        <span style={{ fontSize: 9, fontWeight: 800, color: badge.color, background: badge.bg, borderRadius: 10, padding: '3px 9px', flexShrink: 0 }}>{badge.label}</span>
      </div>

      {structure?.is_association && (
        <div style={{ display: 'inline-block', fontSize: 9, fontWeight: 800, color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 9, padding: '3px 9px', marginBottom: 10 }}>
          🤝 Association vérifiée
        </div>
      )}

      <div style={{ display: 'grid', gap: 5, fontSize: 10.5, color: T.sub, marginBottom: 14 }}>
        {structure?.siret && <div>SIRET : <span style={{ color: T.text, fontWeight: 700 }}>{formatSiret(structure.siret)}</span></div>}
        {structure?.siren && <div>SIREN : <span style={{ color: T.text, fontWeight: 700 }}>{structure.siren}</span></div>}
        {officialAddress && <div>Adresse : <span style={{ color: T.text, fontWeight: 700 }}>{officialAddress}</span></div>}
        {structure?.naf_code && <div>Activité (NAF) : <span style={{ color: T.text, fontWeight: 700 }}>{structure.naf_code}{structure.naf_label ? ` — ${structure.naf_label}` : ''}</span></div>}
        {structure?.legal_form && <div>Forme juridique : <span style={{ color: T.text, fontWeight: 700 }}>{structure.legal_form}</span></div>}
        {structure?.siret_established_at && <div>Créée le : <span style={{ color: T.text, fontWeight: 700 }}>{new Date(structure.siret_established_at).toLocaleDateString('fr-FR')}</span></div>}
        {structure?.siret_checked_at && <div>Dernière vérification : <span style={{ color: T.text, fontWeight: 700 }}>{new Date(structure.siret_checked_at).toLocaleDateString('fr-FR')}</span></div>}
      </div>

      <div style={{ fontSize: 9.5, color: T.mu, lineHeight: 1.5, marginBottom: 12 }}>
        Ces informations proviennent du registre officiel des entreprises françaises — elles ne sont pas modifiables directement.
      </div>

      {error && <div style={{ fontSize: 11, color: T.red, marginBottom: 10 }}>{error}</div>}

      {canRetry && !editingSiret && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => reverify()} disabled={busy} style={{ flex: 1, background: T.row, color: T.text, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '9px 0', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
            {busy ? '…' : 'Revérifier ce SIRET'}
          </button>
          <button onClick={() => setEditingSiret(true)} style={{ flex: 1, background: 'none', border: `1px solid ${T.cb}`, color: T.sub, borderRadius: 8, padding: '9px 0', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
            Corriger le SIRET
          </button>
        </div>
      )}
      {canRetry && editingSiret && (
        <div>
          <input
            aria-label="Nouveau SIRET"
            value={siretInput}
            onChange={(e) => setSiretInput(formatSiret(e.target.value))}
            placeholder="123 456 789 00012"
            style={{ ...inp, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => reverify(siretInput)} disabled={busy || siretInput.replace(/\D/g, '').length !== 14} style={{ flex: 1, background: '#fff', color: '#000', border: 'none', borderRadius: 8, padding: '9px 0', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
              {busy ? '…' : 'Soumettre'}
            </button>
            <button onClick={() => { setEditingSiret(false); setSiretInput(''); }} style={{ flex: 1, background: T.row, color: T.sub, border: 'none', borderRadius: 8, padding: '9px 0', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StructurePresentationCard({ structure, notif, onSaved }: { structure: Structure | null; notif: (m: string) => void; onSaved: () => Promise<void> }) {
  const [tradeName, setTradeName] = useState(structure?.trade_name ?? '');
  const [logoUrl, setLogoUrl] = useState(structure?.logo_url ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!structure || busy) return;
    setBusy(true);
    try {
      await updateStructurePresentation(structure.id, { trade_name: tradeName.trim() || null, logo_url: logoUrl.trim() || null });
      await onSaved();
      notif('Présentation mise à jour ✓');
    } catch (e) {
      notif(describeError(e, 'la mise à jour de la présentation'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Nom commercial / enseigne</div>
      <input aria-label="Nom commercial" value={tradeName} onChange={(e) => setTradeName(e.target.value)} placeholder={structure?.name ?? 'Nom affiché aux travailleurs'} style={{ ...inp, marginBottom: 12 }} />
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Logo (URL)</div>
      <input aria-label="URL du logo" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" style={{ ...inp, marginBottom: 12 }} />
      <button onClick={save} disabled={busy} style={{ width: '100%', background: busy ? T.row : '#fff', color: busy ? T.mu : '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer' }}>
        {busy ? '…' : 'Enregistrer'}
      </button>
    </div>
  );
}

function ContactCard({
  profile,
  onSave,
}: {
  profile: Profile | null;
  onSave: (updates: ProfileUpdate) => Promise<void>;
}) {
  const [city, setCity] = useState(profile?.city ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [address, setAddress] = useState(profile?.address ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [busy, setBusy] = useState(false);

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
      <div style={{ fontSize: 10, color: T.mu, lineHeight: 1.5, marginBottom: 12 }}>
        Coordonnées internes (jamais issues du registre) — utilisées par UROSI pour te contacter.
      </div>
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

      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Notes (usage interne)</div>
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

        <SectionTitle>Fiche officielle</SectionTitle>
        <SectionErrorBoundary label="Fiche officielle">
          <OfficialProfileCard structure={structure} onReverified={onProfileSaved} />
        </SectionErrorBoundary>

        <SectionTitle>Présentation</SectionTitle>
        <SectionErrorBoundary label="Présentation">
          <StructurePresentationCard structure={structure} notif={notif} onSaved={onProfileSaved} />
        </SectionErrorBoundary>

        <SectionTitle>Coordonnées</SectionTitle>
        <SectionErrorBoundary label="Coordonnées">
          <ContactCard
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
