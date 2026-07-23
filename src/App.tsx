import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { isSupabaseConfigured } from '@/lib/supabase';
import { T, FONT } from '@/components/ui/theme';

// Chaque route est chargée à la demande : la démo de la landing ne télécharge
// plus les espaces travailleur/structure/fondateur, et inversement. Aucun
// changement visuel : le fallback est le même « Chargement… » qu'avant.
const EntryPage = lazy(() => import('@/app/EntryPage').then((m) => ({ default: m.EntryPage })));
const DemoExperience = lazy(() => import('@/app/DemoExperience').then((m) => ({ default: m.DemoExperience })));
const SignInPage = lazy(() => import('@/features/auth/SignInPage').then((m) => ({ default: m.SignInPage })));
const WorkerSignupPage = lazy(() => import('@/features/auth/WorkerSignupPage').then((m) => ({ default: m.WorkerSignupPage })));
const StructureSignupPage = lazy(() => import('@/features/auth/StructureSignupPage').then((m) => ({ default: m.StructureSignupPage })));
const ResetPasswordPage = lazy(() => import('@/features/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const WorkerApp = lazy(() => import('@/features/worker/WorkerApp').then((m) => ({ default: m.WorkerApp })));
const StructureApp = lazy(() => import('@/features/structure/StructureApp').then((m) => ({ default: m.StructureApp })));
const CheckinPage = lazy(() => import('@/features/missions/CheckinPage').then((m) => ({ default: m.CheckinPage })));
const ScanPage = lazy(() => import('@/features/missions/ScanPage').then((m) => ({ default: m.ScanPage })));
const WorkerAttendancePage = lazy(() => import('@/features/missions/WorkerAttendancePage').then((m) => ({ default: m.WorkerAttendancePage })));
const ValidatorApp = lazy(() => import('@/features/missions/ValidatorApp').then((m) => ({ default: m.ValidatorApp })));
const FounderAdminPage = lazy(() => import('@/features/founder/FounderAdminPage').then((m) => ({ default: m.FounderAdminPage })));
const PaymentResultPage = lazy(() => import('@/features/payments/PaymentResultPage').then((m) => ({ default: m.PaymentResultPage })));

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
  const location = useLocation();

  // La démo est volontairement autonome : elle doit rester consultable sans
  // variables Supabase et ne déclenche aucune écriture dans les tables réelles.
  if (location.pathname === '/demo') return <DemoExperience />;

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
        <Route path="/fondateur" element={<Navigate to="/connexion?next=/fondateur" replace />} />
        <Route path="/fondateur/kyc" element={<Navigate to="/connexion?next=/fondateur" replace />} />
        <Route path="/reinitialisation" element={<ResetPasswordPage />} />
        <Route path="/pointage/:applicationId/:token" element={<CheckinPage />} />
        <Route path="/scan/:token" element={<ScanPage />} />
        <Route path="/paiement/succes" element={<PaymentResultPage outcome="success" />} />
        <Route path="/paiement/annule" element={<PaymentResultPage outcome="cancel" />} />
        <Route path="/valider" element={<WorkerAttendancePage />} />
        <Route path="/valider/:qrCode" element={<WorkerAttendancePage />} />
        <Route path="/validation" element={<Navigate to="/connexion?next=/validation" replace />} />
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
      <Route path="/fondateur" element={<FounderAdminPage />} />
      <Route path="/fondateur/kyc" element={<Navigate to="/fondateur?section=kyc" replace />} />
      <Route path="/reinitialisation" element={<ResetPasswordPage />} />
      <Route path="/pointage/:applicationId/:token" element={<CheckinPage />} />
      <Route path="/scan/:token" element={<ScanPage />} />
      <Route path="/paiement/succes" element={<PaymentResultPage outcome="success" />} />
      <Route path="/paiement/annule" element={<PaymentResultPage outcome="cancel" />} />
      <Route path="/valider" element={<WorkerAttendancePage />} />
      <Route path="/valider/:qrCode" element={<WorkerAttendancePage />} />
      <Route path="/validation" element={<ValidatorApp />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Suspense fallback={<Centered text="Chargement…" />}>
          <AppShell />
        </Suspense>
      </AuthProvider>
    </ErrorBoundary>
  );
}
