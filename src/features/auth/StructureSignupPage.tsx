import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicShell } from '@/components/public/PublicShell';
import { Icon } from '@/components/public/icons';
import { formatSiret, isValidSiret, normalizeSiret } from '@/features/structure/verification';
import { describeError } from '@/lib/errors';
import { signUp } from './authService';
import { PasswordField } from './PasswordField';

export function StructureSignupPage() {
  const [f, setF] = useState({ nom: '', siret: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const siretDigits = normalizeSiret(f.siret);
  const siretOk = isValidSiret(f.siret);
  const ok = f.nom.trim().length >= 2 && siretOk && /\S+@\S+\.\S+/.test(f.email) && f.password.length >= 6;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!ok) {
      setError(!siretOk ? 'Renseigne un numéro SIRET valide (14 chiffres).' : 'Renseigne le nom de la structure, un email et un mot de passe (6 caractères minimum).');
      return;
    }
    setBusy(true);
    try {
      const data = await signUp({
        email: f.email.trim(),
        password: f.password,
        fullName: f.nom.trim(),
        role: 'structure_admin',
        structureName: f.nom.trim(),
        siret: siretDigits,
        phone: f.phone.trim() || undefined,
      });
      if (!data.session) setDone(true);
    } catch (e) {
      setError(describeError(e, 'la création du compte'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell minimal active="structure">
      <div className="pub-wrap pub-auth" style={{ maxWidth: 1040 }}>
        <section className="pub-card pub-auth-card" aria-labelledby="struct-title">
          <Link to="/acces" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700, color: '#4a5a72', textDecoration: 'none', marginBottom: 12 }}>
            <Icon name="arrowLeft" size={15} /> Retour
          </Link>
          {done ? (
            <div role="status" style={{ textAlign: 'center', padding: '20px 4px' }}>
              <div style={{ display: 'inline-flex', width: 60, height: 60, borderRadius: 20, background: '#e5f6ec', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={30} color="#13824a" />
              </div>
              <h1 className="pub-h1" style={{ fontSize: 26 }}>Espace structure créé</h1>
              <p className="pub-lede" style={{ fontSize: 15 }}>
                Confirmez votre adresse depuis l’email reçu, puis connectez-vous : nous vérifions votre SIRET auprès du registre officiel à la première connexion.
              </p>
              <Link className="pub-btn pub-btn-primary" to="/connexion" style={{ marginTop: 18 }}>Se connecter</Link>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <h1 id="struct-title" className="pub-h1" style={{ fontSize: 28, marginTop: 0 }}>Avant de publier, on identifie votre structure.</h1>
              <p className="pub-lede" style={{ fontSize: 15, marginBottom: 20 }}>
                Les missions sont réservées aux structures vérifiées. Cette vérification permet aux participants de savoir pour qui ils s’engagent.
              </p>
              <div className="pub-form-grid">
                <div className="pub-field" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="st-nom">Nom de l’organisation</label>
                  <input id="st-nom" className="pub-input" aria-label="Nom de la structure" value={f.nom} onChange={(e) => setF((x) => ({ ...x, nom: e.target.value }))} placeholder="Nom de votre organisation" autoComplete="organization" autoFocus />
                </div>
                <div className="pub-field" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="st-siret">SIRET</label>
                  <input id="st-siret" className="pub-input" aria-label="SIRET" value={f.siret} onChange={(e) => setF((x) => ({ ...x, siret: formatSiret(e.target.value) }))} placeholder="Numéro SIRET (14 chiffres)" inputMode="numeric" />
                  {siretDigits.length > 0 && (
                    <span className="pub-hint" style={{ color: siretOk ? '#13824a' : '#a8570c' }}>
                      {siretOk ? 'Format valide — vérification auprès du registre officiel après l’inscription.' : 'Le SIRET doit contenir 14 chiffres valides.'}
                    </span>
                  )}
                </div>
                <div className="pub-field">
                  <label htmlFor="st-email">Email professionnel</label>
                  <input id="st-email" className="pub-input" aria-label="Email" value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} placeholder="contact@structure.org" type="email" inputMode="email" autoComplete="email" />
                </div>
                <div className="pub-field">
                  <label htmlFor="st-phone">Téléphone <span className="pub-hint">(facultatif)</span></label>
                  <input id="st-phone" className="pub-input" aria-label="Téléphone" value={f.phone} onChange={(e) => setF((x) => ({ ...x, phone: e.target.value }))} placeholder="Votre téléphone" inputMode="tel" autoComplete="tel" />
                </div>
                <div className="pub-field" style={{ gridColumn: '1 / -1' }}>
                  <span className="pub-label">Mot de passe</span>
                  <PasswordField value={f.password} onChange={(v) => setF((x) => ({ ...x, password: v }))} />
                </div>
              </div>
              <p className="pub-hint" style={{ fontSize: 12.5, color: '#7b8aa1', marginTop: 12, lineHeight: 1.55 }}>
                Le statut d’association est reconnu automatiquement à partir du registre officiel. Les missions solidaires sont publiées par les associations vérifiées.
              </p>
              {error && <div role="alert" style={{ marginTop: 12, fontSize: 13.5, color: '#d33a3f' }}>{error}</div>}
              <button type="submit" className="pub-btn pub-btn-primary pub-btn-block" disabled={busy} style={{ marginTop: 18, minHeight: 50 }}>
                {busy ? 'Création…' : 'Créer mon espace structure'}
              </button>
              <p style={{ fontSize: 12.5, color: '#7b8aa1', textAlign: 'center', marginTop: 12, lineHeight: 1.55 }}>
                En continuant, vous acceptez les <a href="/cgu" target="_blank" rel="noreferrer" style={{ color: '#1d5fe6', fontWeight: 700 }}>CGU</a> et la{' '}
                <a href="/confidentialite" target="_blank" rel="noreferrer" style={{ color: '#1d5fe6', fontWeight: 700 }}>politique de confidentialité</a>.
              </p>
              <p style={{ fontSize: 14, textAlign: 'center', marginTop: 8 }}>
                Déjà un compte ? <Link to="/connexion" style={{ color: '#1d5fe6', fontWeight: 800 }}>Se connecter</Link>
              </p>
            </form>
          )}
        </section>

        <aside className="pub-side" aria-label="Pourquoi UROSI">
          {[
            { icon: 'users' as const, title: 'Des bénévoles motivés', text: 'Touchez une communauté engagée et locale, prête à agir.' },
            { icon: 'shield' as const, title: 'Une structure vérifiée', text: 'Votre identification renforce la confiance des participants.' },
            { icon: 'sparkles' as const, title: 'Un suivi simple', text: 'Publiez, gérez les candidatures et confirmez les participations depuis un espace dédié.' },
          ].map((item) => (
            <div key={item.title} className="pub-side-item">
              <span className="pub-side-icon"><Icon name={item.icon} size={20} color="#1d5fe6" /></span>
              <div><strong>{item.title}</strong><span>{item.text}</span></div>
            </div>
          ))}
        </aside>
      </div>
    </PublicShell>
  );
}
