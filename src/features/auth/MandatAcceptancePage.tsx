import { useState } from 'react';
import { Logo } from '@/components/ui/Logo';
import { T, FONT } from '@/components/ui/theme';
import { useAuth } from './AuthContext';
import { acceptMandat } from './mandatService';
import { describeError } from '@/lib/errors';
import type { ProfileRole } from '@/types/database.types';

// Distinct des CGU (acceptees a l'inscription) : ce mandat porte
// specifiquement sur la representation et l'encaissement pour compte
// d'autrui (art. 1984 du Code civil). Aucun bypass, y compris pour les
// comptes de test Fondateur — le role vient toujours du profil reel.
const CONTENT: Record<ProfileRole, { paragraphs: string[]; checkboxLabel: string }> = {
  worker: {
    paragraphs: [
      "En acceptant, tu donnes mandat à UROSI (art. 1984 du Code civil) pour te mettre en relation avec des structures, encaisser en ton nom les paiements liés à tes missions, et te les reverser.",
      "UROSI agit comme mandataire, pas comme employeur : aucun lien de subordination n'est créé. Tu restes libre d'accepter, de refuser ou d'annuler une mission, sans conséquence sur ton accès.",
      "Ce mandat est distinct des conditions d'utilisation déjà acceptées à l'inscription : il porte spécifiquement sur la représentation et l'encaissement pour ton compte.",
    ],
    checkboxLabel: 'Je donne mandat à UROSI pour agir en mon nom dans les conditions décrites ci-dessus.',
  },
  structure_admin: {
    paragraphs: [
      "En acceptant, tu donnes mandat à UROSI (art. 1984 du Code civil) pour recruter en ton nom des travailleurs indépendants sur tes missions, encaisser les paiements correspondants, et les reverser aux travailleurs une fois la mission terminée.",
      "UROSI agit comme mandataire, pas comme employeur : aucun lien de subordination n'est créé entre ta structure et les travailleurs qui interviennent.",
      "Ce mandat est distinct des conditions d'utilisation déjà acceptées à l'inscription : il porte spécifiquement sur la représentation et l'encaissement pour le compte de ta structure.",
    ],
    checkboxLabel: 'Je donne mandat à UROSI pour agir au nom de ma structure dans les conditions décrites ci-dessus.',
  },
};

export function MandatAcceptancePage() {
  const { profile, refreshMandat, signOut } = useAuth();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le gate en amont (App.tsx) ne rend cet ecran qu'apres chargement du
  // profil : ce cas ne devrait jamais s'afficher, il evite juste un crash.
  if (!profile) return null;

  const copy = CONTENT[profile.role];

  async function submit() {
    if (!checked || busy || !profile) return;
    setBusy(true);
    setError(null);
    try {
      await acceptMandat(profile.role);
      await refreshMandat();
    } catch (e) {
      setError(describeError(e, "l'enregistrement du mandat"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT, padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', margin: '18px 0 20px' }}>
          <Logo sz={54} />
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: T.text, marginBottom: 4 }}>Le mandat UROSI</div>
          <div style={{ fontSize: 11, color: T.mu, marginBottom: 14 }}>Une dernière étape avant d'accéder à ton espace.</div>
          {copy.paragraphs.map((p, i) => (
            <p key={i} style={{ fontSize: 12, color: T.sub, lineHeight: 1.6, margin: '0 0 12px' }}>
              {p}
            </p>
          ))}
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer', margin: '16px 0' }}>
            <input
              type="checkbox"
              aria-label="J'accepte le mandat"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              style={{ marginTop: 2, accentColor: '#0891b2' }}
            />
            <span style={{ fontSize: 12, color: T.text, lineHeight: 1.5, fontWeight: 700 }}>{copy.checkboxLabel}</span>
          </label>
          {error && <div style={{ fontSize: 12, color: T.red, marginBottom: 10 }}>{error}</div>}
          <button
            onClick={() => void submit()}
            disabled={!checked || busy}
            style={{
              width: '100%',
              background: checked && !busy ? '#fff' : T.row,
              color: checked && !busy ? '#000' : T.mu,
              border: 'none',
              borderRadius: 10,
              padding: '13px 0',
              fontSize: 14,
              fontWeight: 900,
              cursor: checked && !busy ? 'pointer' : 'not-allowed',
              marginTop: 4,
            }}
          >
            {busy ? '…' : 'Accepter et continuer'}
          </button>
          <button
            onClick={() => void signOut()}
            style={{ width: '100%', background: 'none', border: 'none', color: T.mu, fontSize: 11, fontWeight: 700, cursor: 'pointer', marginTop: 14, textAlign: 'center' }}
          >
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
