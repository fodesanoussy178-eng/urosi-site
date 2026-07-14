import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { isSupabaseConfigured } from '@/lib/supabase';
import { T, FONT } from '@/components/ui/theme';
import { EntryPage } from '@/app/EntryPage';
import { DemoExperience } from '@/app/DemoExperience';
import { SignInPage } from '@/features/auth/SignInPage';
import { WorkerSignupPage } from '@/features/auth/WorkerSignupPage';
import { StructureSignupPage } from '@/features/auth/StructureSignupPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { WorkerApp } from '@/features/worker/WorkerApp';
import { StructureApp } from '@/features/structure/StructureApp';
import { CheckinPage } from '@/features/missions/CheckinPage';
import { ScanPage } from '@/features/missions/ScanPage';
import { KycReviewPage } from '@/features/founder/KycReviewPage';

function Centered({ text }: { text: string }) {
  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: T.sub, fontSize: 13, padding: 24, textAlign: 'center' }}>
      {text}
    </div>
  );
}

// Le site vitrine (/) est une page statique servie par Vercel, hors React :
// une navigation interne vers "/" recharge la page.
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
        {/* Non connecté : /app passe par la connexion, puis l'app s'ouvre. */}
        <Route path="/app" element={<Navigate to="/connexion" replace />} />
        <Route path="/acces" element={<EntryPage />} />
        <Route path="/demo" element={<DemoExperience />} />
        <Route path="/connexion" element={<SignInPage />} />
        <Route path="/inscription/travailleur" element={<WorkerSignupPage />} />
        <Route path="/inscription/structure" element={<StructureSignupPage />} />
        <Route path="/fondateur/kyc" element={<Navigate to="/connexion?next=/fondateur/kyc" replace />} />
        <Route path="/reinitialisation" element={<ResetPasswordPage />} />
        <Route path="/pointage/:applicationId/:token" element={<CheckinPage />} />
        <Route path="/scan/:token" element={<ScanPage />} />
        <Route path="*" element={<Navigate to="/connexion" replace />} />
      </Routes>
    );
  }

  if (!profile) {
    return <Centered text="Chargement du profil…" />;
  }

  return (
    <Routes>
      <Route path="/" element={<StaticHome />} />
      <Route path="/demo" element={<DemoExperience />} />
      <Route path="/connexion" element={<SignInPage />} />
      <Route path="/app" element={profile.role === 'structure_admin' ? <StructureApp /> : <WorkerApp />} />
      <Route path="/fondateur/kyc" element={<KycReviewPage />} />
      <Route path="/reinitialisation" element={<ResetPasswordPage />} />
      <Route path="/pointage/:applicationId/:token" element={<CheckinPage />} />
      <Route path="/scan/:token" element={<ScanPage />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
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
