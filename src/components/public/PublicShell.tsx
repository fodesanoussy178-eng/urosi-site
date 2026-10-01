import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useOptionalAuth } from '@/features/auth/AuthContext';

// Logo UROSI (même dessin que Logo.tsx) décliné en bleu pour les fonds clairs.
export function BrandLogo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="urosi-brand" x1="20" y1="5" x2="80" y2="95" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1d5fe6" />
          <stop offset="1" stopColor="#0a8bd6" />
        </linearGradient>
      </defs>
      <path d="M47 95Q46 74 44 61Q42 49 50 44Q58 49 56 61Q54 74 53 95Z" fill="url(#urosi-brand)" />
      <path d="M50 44Q34 37 20 27Q29 25 38 31Q44 36 50 40" fill="url(#urosi-brand)" opacity=".9" />
      <path d="M50 44Q66 37 80 27Q71 25 62 31Q56 36 50 40" fill="url(#urosi-brand)" opacity=".9" />
      <path d="M42 29Q37 16 39 7Q45 11 45 20Q45 26 44 31" fill="url(#urosi-brand)" opacity=".85" />
      <path d="M58 29Q63 16 61 7Q55 11 55 20Q55 26 56 31" fill="url(#urosi-brand)" opacity=".85" />
      <ellipse cx="19" cy="25" rx="7" ry="4.5" fill="#1d5fe6" transform="rotate(-20 19 25)" />
      <ellipse cx="81" cy="25" rx="7" ry="4.5" fill="#1d5fe6" transform="rotate(20 81 25)" />
      <ellipse cx="50" cy="7" rx="6.5" ry="4" fill="#0a8bd6" />
    </svg>
  );
}

type Active = 'missions' | 'structure' | 'profil';

// Navigation minimale : Missions et, une fois connecté, Mon profil.
export function PublicNav({ active, minimal = false }: { active?: Active; minimal?: boolean }) {
  const auth = useOptionalAuth();
  const session = auth?.session ?? null;
  const profile = auth?.profile ?? null;
  const structure = profile?.role === 'structure_admin';
  return (
    <header className="pub-nav">
      <div className="pub-wrap pub-nav-inner">
        <a className="pub-brand" href="/" aria-label="UROSI, accueil">
          <BrandLogo />
          UROSI
        </a>
        {!minimal && (
          <nav className="pub-links" aria-label="Navigation">
            <Link to="/missions" aria-current={active === 'missions' ? 'page' : undefined}>Missions</Link>
            {!session && <Link to="/inscription/structure" aria-current={active === 'structure' ? 'page' : undefined}>Espace structure</Link>}
          </nav>
        )}
        <div className="pub-actions">
          {session ? (
            structure ? (
              <Link className="pub-btn pub-btn-ghost" to="/app">Mon espace</Link>
            ) : (
              <Link className="pub-btn pub-btn-ghost" to="/profil" aria-current={active === 'profil' ? 'page' : undefined}>Mon profil</Link>
            )
          ) : (
            <>
              <Link className="pub-btn pub-btn-ghost" to="/connexion">Se connecter</Link>
              {!minimal && <Link className="pub-btn pub-btn-primary pub-hide-sm" to="/acces">S’inscrire</Link>}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="pub-footer">
      <div className="pub-wrap">
        UROSI · missions solidaires · Métropole Européenne de Lille
        <br />
        <a href="/mentions-legales">Mentions légales</a> · <a href="/cgu">CGU</a> · <a href="/confidentialite">Confidentialité</a>
      </div>
    </footer>
  );
}

export function PublicShell({ children, active, minimal, footer = true }: { children: ReactNode; active?: Active; minimal?: boolean; footer?: boolean }) {
  return (
    <div className="pub">
      <PublicNav active={active} minimal={minimal} />
      <main>{children}</main>
      {footer && <PublicFooter />}
    </div>
  );
}
