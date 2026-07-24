import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { T, FONT } from '@/components/ui/theme';
import { SignInForm } from '@/features/auth/SignInForm';
import { setStoredAuthRedirect } from '@/features/auth/authRedirect';
import { supabase } from '@/lib/supabase';
import { confirmAttendanceQR, fetchScanContext, type ScanContext } from './attendanceService';
import { ScanConfirmationCard } from './ScanConfirmationCard';
import { describeError } from '@/lib/errors';

export function ScanPage() {
  const { token } = useParams<{ token: string }>();
  const [authReady, setAuthReady] = useState(false);
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ScanContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState('');

  // Route publique : ne se fie pas seulement au contexte d'auth partagé
  // (susceptible d'être encore en cours de résolution ailleurs dans l'app).
  // On vérifie explicitement getSession() PUIS getUser() (validation serveur
  // du jeton) dès le montage, pour ne jamais afficher la connexion à tort à
  // une structure déjà connectée sur son téléphone. onAuthStateChange couvre
  // le cas où la connexion aboutit pendant que cette page reste montée
  // (redirection post-connexion vers la même URL /scan/:token).
  useEffect(() => {
    let active = true;

    async function check() {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!active) return;
      if (!sessionData.session) {
        setAuthedUserId(null);
        setAuthReady(true);
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      if (!active) return;
      setAuthedUserId(userData.user?.id ?? null);
      setAuthReady(true);
    }
    check();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setAuthedUserId(nextSession?.user.id ?? null);
      setAuthReady(true);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Aucune session valide : on conserve l'URL du QR pour y revenir
  // automatiquement une fois connecté (jamais vers /app ou l'accueil).
  useEffect(() => {
    if (authReady && !authedUserId) setStoredAuthRedirect(window.location.pathname);
  }, [authReady, authedUserId]);

  useEffect(() => {
    if (!authedUserId || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchScanContext(token)
      .then(setCtx)
      .catch((e) => setError(describeError(e, 'la lecture du QR')))
      .finally(() => setLoading(false));
  }, [authedUserId, token]);

  async function confirm() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      setCtx(await confirmAttendanceQR(token, pin || null));
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message === 'not_authorized') setError('Ce compte n’est pas reconnu comme validateur autorisé. Demande le code de secours à un responsable de la structure.');
      else if (message === 'invalid_pin') setError('Code de secours invalide ou expiré.');
      else setError(describeError(e, 'la validation du pointage'));
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT, padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 430 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Logo sz={54} />
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 17 }}>{children}</div>
      </div>
    </div>
  );

  if (!authReady) return shell(<div style={{ color: T.mu, fontSize: 12, textAlign: 'center' }}>Chargement…</div>);

  if (!authedUserId) {
    return shell(
      <>
        <div style={{ fontSize: 15, fontWeight: 900, color: T.text, marginBottom: 4 }}>Validation UROSI</div>
        <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.55, marginBottom: 16 }}>
          Connecte-toi avec un compte de la structure pour confirmer ce QR. Le lien ne contient aucune information personnelle.
        </div>
        <SignInForm />
      </>,
    );
  }

  if (loading) return shell(<div style={{ color: T.mu, fontSize: 12, textAlign: 'center' }}>Lecture du QR…</div>);

  return shell(<ScanConfirmationCard ctx={ctx} error={error} busy={busy} pin={pin} onPinChange={setPin} onConfirm={confirm} />);
}
