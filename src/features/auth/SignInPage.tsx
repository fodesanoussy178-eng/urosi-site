import { Link } from 'react-router-dom';
import { PublicShell } from '@/components/public/PublicShell';
import { SignInForm } from './SignInForm';

export function SignInPage() {
  return (
    <PublicShell minimal>
      <div className="pub-wrap" style={{ maxWidth: 460, padding: '40px 16px 20px' }}>
        <section className="pub-card pub-auth-card">
          <h1 className="pub-h1" style={{ fontSize: 28, marginTop: 0 }}>Content de te revoir</h1>
          <p className="pub-lede" style={{ fontSize: 15, marginBottom: 18 }}>Connecte-toi pour retrouver tes missions et ton parcours.</p>
          <SignInForm />
          <p style={{ fontSize: 14, textAlign: 'center', marginTop: 14 }}>
            Pas encore de compte ? <Link to="/acces" style={{ color: '#1d5fe6', fontWeight: 800 }}>S’inscrire</Link>
          </p>
        </section>
      </div>
    </PublicShell>
  );
}
