import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicShell } from '@/components/public/PublicShell';
import { Icon } from '@/components/public/icons';
import { INTEREST_OPTIONS } from '@/features/missions/categories';
import { MEL_CITIES } from '@/features/participant/publicCatalog';
import { describeError } from '@/lib/errors';
import { signUp } from './authService';
import { PasswordField } from './PasswordField';

// Inscription participant (phase 0) : rapide, humaine, sans friction.
// Uniquement l'essentiel, champs vides, placeholders neutres. Aucun
// document, IBAN, Stripe ni SIRET ; la photo s'ajoute plus tard, facultative.
export function WorkerSignupPage() {
  const [f, setF] = useState({ prenom: '', nom: '', email: '', ville: '', password: '' });
  const [interests, setInterests] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailOk = /\S+@\S+\.\S+/.test(f.email);
  const ok = f.prenom.trim().length >= 2 && f.nom.trim().length >= 1 && emailOk && f.password.length >= 6 && f.ville.trim().length >= 2;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!ok) {
      setError(f.password && f.password.length < 6 ? 'Le mot de passe doit contenir au moins 6 caractères.' : 'Renseigne ton prénom, ton nom (ou son initiale), ton email, ta ville et un mot de passe.');
      return;
    }
    setBusy(true);
    try {
      const data = await signUp({
        email: f.email.trim(),
        password: f.password,
        fullName: `${f.prenom.trim()} ${f.nom.trim()}`.trim(),
        role: 'worker',
        city: f.ville.trim(),
        ...(interests.length > 0 ? { interests } : {}),
      });
      if (!data.session) setDone(true);
    } catch (e) {
      setError(describeError(e, 'la création du compte'));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [key]: e.target.value }));

  return (
    <PublicShell minimal>
      <div className="pub-wrap pub-auth" style={{ maxWidth: 1040 }}>
        <section className="pub-card pub-auth-card" aria-labelledby="signup-title">
          <Link to="/acces" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700, color: '#4a5a72', textDecoration: 'none', marginBottom: 12 }}>
            <Icon name="arrowLeft" size={15} /> Retour
          </Link>
          {done ? (
            <div role="status" style={{ textAlign: 'center', padding: '20px 4px' }}>
              <div style={{ display: 'inline-flex', width: 60, height: 60, borderRadius: 20, background: '#e5f6ec', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={30} color="#13824a" />
              </div>
              <h1 className="pub-h1" style={{ fontSize: 26 }}>Compte créé !</h1>
              <p className="pub-lede" style={{ fontSize: 15 }}>
                Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi. Tes premières missions t’attendent.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
                <Link className="pub-btn pub-btn-primary" to="/connexion">Se connecter</Link>
                <Link className="pub-btn pub-btn-ghost" to="/missions">Voir les missions</Link>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <h1 id="signup-title" className="pub-h1" style={{ fontSize: 28, marginTop: 0 }}>Crée ton compte</h1>
              <p className="pub-lede" style={{ fontSize: 15, marginBottom: 20 }}>Rejoins une communauté de personnes qui s’engagent près de chez elles. C’est gratuit.</p>
              <div className="pub-form-grid">
                <div className="pub-field">
                  <label htmlFor="su-prenom">Prénom</label>
                  <input id="su-prenom" className="pub-input" aria-label="Prénom" value={f.prenom} onChange={set('prenom')} placeholder="Prénom" autoComplete="given-name" autoFocus />
                </div>
                <div className="pub-field">
                  <label htmlFor="su-nom">Nom <span className="pub-hint">(ou initiale)</span></label>
                  <input id="su-nom" className="pub-input" aria-label="Nom" value={f.nom} onChange={set('nom')} placeholder="Nom ou initiale" autoComplete="family-name" />
                </div>
                <div className="pub-field">
                  <label htmlFor="su-email">Email</label>
                  <input id="su-email" className="pub-input" aria-label="Email" value={f.email} onChange={set('email')} placeholder="ton@email.fr" type="email" inputMode="email" autoComplete="email" />
                </div>
                <div className="pub-field">
                  <span className="pub-label">Mot de passe</span>
                  <PasswordField value={f.password} onChange={(v) => setF((x) => ({ ...x, password: v }))} />
                </div>
                <div className="pub-field" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="su-ville">Ville</label>
                  <input id="su-ville" className="pub-input" aria-label="Ville" value={f.ville} onChange={set('ville')} placeholder="Ville" list="su-villes" autoComplete="address-level2" />
                  <datalist id="su-villes">{MEL_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
                </div>
              </div>

              <div className="pub-field" style={{ marginTop: 16 }}>
                <span className="pub-label">Tes centres d’intérêt <span className="pub-hint">(facultatif)</span></span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {INTEREST_OPTIONS.map((c) => {
                    const on = interests.includes(c.key);
                    return (
                      <button key={c.key} type="button" aria-pressed={on} className="pub-chip" aria-selected={on} onClick={() => setInterests((prev) => (on ? prev.filter((k) => k !== c.key) : [...prev, c.key]))}>
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {error && <div role="alert" style={{ marginTop: 14, fontSize: 13.5, color: '#d33a3f' }}>{error}</div>}
              <button type="submit" className="pub-btn pub-btn-primary pub-btn-block" disabled={busy} style={{ marginTop: 20, minHeight: 50 }}>
                {busy ? 'Création…' : 'Créer mon compte'}
              </button>
              <p style={{ fontSize: 12.5, color: '#7b8aa1', textAlign: 'center', marginTop: 12, lineHeight: 1.55 }}>
                En créant ton compte, tu acceptes les <a href="/cgu" target="_blank" rel="noreferrer" style={{ color: '#1d5fe6', fontWeight: 700 }}>conditions d’utilisation</a> et la{' '}
                <a href="/confidentialite" target="_blank" rel="noreferrer" style={{ color: '#1d5fe6', fontWeight: 700 }}>politique de confidentialité</a>. Aucun justificatif n’est demandé.
              </p>
              <p style={{ fontSize: 14, textAlign: 'center', marginTop: 8 }}>
                Déjà un compte ? <Link to="/connexion" style={{ color: '#1d5fe6', fontWeight: 800 }}>Se connecter</Link>
              </p>
            </form>
          )}
        </section>

        <aside className="pub-side" aria-label="Ce qui t’attend">
          {[
            { icon: 'pin' as const, title: 'Des missions près de chez toi', text: 'Quelques heures, dans ton quartier, quand tu es disponible.' },
            { icon: 'route' as const, title: 'Un parcours qui grandit', text: 'Chaque mission réalisée rejoint ton parcours et ton CV UROSI.' },
            { icon: 'shield' as const, title: 'Des structures vérifiées', text: 'Tu sais toujours pour qui tu t’engages.' },
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
