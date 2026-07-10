import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { isSupabaseConfigured } from '@/lib/supabase';
import { T, FONT } from '@/components/ui/theme';
import { EntryPage } from '@/app/EntryPage';
import { LandingPage } from '@/app/LandingPage';
import { SignInPage } from '@/features/auth/SignInPage';
import { WorkerSignupPage } from '@/features/auth/WorkerSignupPage';
import { StructureSignupPage } from '@/features/auth/StructureSignupPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { WorkerApp } from '@/features/worker/WorkerApp';
import { StructureApp } from '@/features/structure/StructureApp';
import { CheckinPage } from '@/features/missions/CheckinPage';

function Centered({ text }: { text: string }) {
  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: T.sub, fontSize: 13, padding: 24, textAlign: 'center' }}>
      {text}
    </div>
  );
}

// Le site vitrine (/) est une page statique servie par Vercel, hors React.
// Quand une navigation interne pointe vers "/", on recharge la page pour que
// le serveur serve la vitrine.
function StaticHome() {
  useEffect(() => {
    window.location.replace('/');
  }, []);
  return <Centered text="Retour à l'accueil…" />;
}

function AppShell() {
  const { session, profile, loading } = useAuth();

  if (!isSupabaseConfigured) {
    return <Centered text="Backend non configuré : vérifie VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY." />;
  }

  if (loading) {
    return <Centered text="Chargement…" />;
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/" element={<StaticHome />} />
        {/* /demo.html : la démo interactive — missions réelles Supabase,
            postuler => connexion/inscription. */}
        <Route path="/demo.html" element={<LandingPage />} />
        <Route path="/app" element={<Navigate to="/demo.html" replace />} />
        <Route path="/acces" element={<EntryPage />} />
        <Route path="/connexion" element={<SignInPage />} />
        <Route path="/inscription/travailleur" element={<WorkerSignupPage />} />
        <Route path="/inscription/structure" element={<StructureSignupPage />} />
        <Route path="/reinitialisation" element={<ResetPasswordPage />} />
        <Route path="/pointage/:applicationId/:token" element={<CheckinPage />} />
        <Route path="*" element={<Navigate to="/demo.html" replace />} />
      </Routes>
    );
  }

  if (!profile) {
    return <Centered text="Chargement du profil…" />;
  }

  return (
    <Routes>
      <Route path="/" element={<StaticHome />} />
      <Route path="/demo.html" element={profile.role === 'structure_admin' ? <StructureApp /> : <WorkerApp />} />
      <Route path="/app" element={<Navigate to="/demo.html" replace />} />
      <Route path="/reinitialisation" element={<ResetPasswordPage />} />
      <Route path="/pointage/:applicationId/:token" element={<CheckinPage />} />
      <Route path="*" element={<Navigate to="/demo.html" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ErrorBoundary>
  );
}
