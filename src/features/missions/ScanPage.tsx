import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { T, FONT, inp } from '@/components/ui/theme';
import { SignInForm } from '@/features/auth/SignInForm';
import { setStoredAuthRedirect } from '@/features/auth/authRedirect';
import { supabase } from '@/lib/supabase';
import { confirmAttendanceQR, fetchScanContext, type ScanContext } from './attendanceService';
import { formatHours } from '@/lib/format';

function fmtTime(value?: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(value?: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

const stateCopy: Record<ScanContext['state'], { title: string; body: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  valid: { title: 'QR prêt à valider', body: 'Vérifie les informations puis confirme le pointage.', tone: 'ok' },
  invalid: { title: 'QR invalide', body: 'Ce lien ne correspond à aucun pointage UROSI valide.', tone: 'bad' },
  expired: { title: 'QR expiré', body: 'Demande au travailleur de regénérer un QR depuis son espace.', tone: 'warn' },
  used: { title: 'QR déjà utilisé', body: 'Ce QR a déjà servi. Un QR de pointage ne fonctionne qu’une seule fois.', tone: 'warn' },
  not_authorized: { title: 'Compte non reconnu', body: 'Ce compte n’est pas reconnu comme validateur autorisé. Connecte-toi avec le bon compte, ou saisis le code de secours fourni par un responsable de la structure.', tone: 'bad' },
  missing_start: { title: 'Début non confirmé', body: 'La fin de mission ne peut pas être validée avant le début.', tone: 'bad' },
  already_started: { title: 'Début déjà confirmé', body: 'Le début de cette mission est déjà enregistré.', tone: 'muted' },
  already_ended: { title: 'Fin déjà confirmée', body: 'La fin de cette mission est déjà enregistrée.', tone: 'muted' },
  confirmed: { title: 'Pointage confirmé', body: 'L’heure exacte a été enregistrée et le travailleur est notifié.', tone: 'ok' },
};

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
      .catch((e) => setError(e instanceof Error ? e.message : 'Lecture du QR impossible.'))
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
      else setError(message || 'Validation impossible.');
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

  const state = ctx?.state ?? 'invalid';
  const details = ctx;
  const copy = stateCopy[state];
  const color = copy.tone === 'ok' ? T.green : copy.tone === 'warn' ? T.amber : copy.tone === 'bad' ? T.red : T.sub;
  const bg = copy.tone === 'ok' ? T.greenBg : copy.tone === 'warn' ? T.amberBg : copy.tone === 'bad' ? T.redBg : T.row;
  const border = copy.tone === 'ok' ? T.greenBorder : copy.tone === 'warn' ? T.amberBorder : copy.tone === 'bad' ? T.redBorder : T.cb;
  const isStart = ctx?.type === 'start';

  return shell(
    <>
      <div style={{ fontSize: 16, fontWeight: 900, color: T.text, marginBottom: 3 }}>
        {isStart ? 'Confirmer le début' : ctx?.type === 'end' ? 'Confirmer la fin' : 'Validation UROSI'}
      </div>
      <div style={{ fontSize: 11, color: T.mu, marginBottom: 13 }}>
        {ctx?.mission_title ? `${ctx.mission_title} · ${ctx.structure_name ?? 'Structure'}` : 'Pointage sécurisé'}
      </div>

      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: '12px 13px', marginBottom: 13 }}>
        <div style={{ fontSize: 13, color, fontWeight: 900 }}>{copy.title}</div>
        <div style={{ fontSize: 10.5, color: T.sub, lineHeight: 1.5, marginTop: 4 }}>{copy.body}</div>
      </div>

      {details && details.state !== 'invalid' && (
        <div style={{ background: T.row, borderRadius: 12, padding: '12px 13px', marginBottom: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, marginBottom: 7 }}>
            <span style={{ color: T.mu }}>Travailleur</span>
            <strong style={{ color: T.text, textAlign: 'right' }}>{details.worker_name ?? 'Travailleur'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, marginBottom: 7 }}>
            <span style={{ color: T.mu }}>Date prévue</span>
            <strong style={{ color: T.text, textAlign: 'right' }}>{fmtDate(details.scheduled_start_at)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, marginBottom: 7 }}>
            <span style={{ color: T.mu }}>Horaires prévus</span>
            <strong style={{ color: T.text, textAlign: 'right' }}>
              {fmtTime(details.scheduled_start_at)} → {fmtTime(details.scheduled_end_at)}
            </strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
            <span style={{ color: T.mu }}>{isStart ? 'Heure actuelle' : 'Durée enregistrée'}</span>
            <strong style={{ color: T.text, textAlign: 'right' }}>
              {isStart ? fmtTime(details.current_time) : details.actual_start_at ? `${fmtTime(details.actual_start_at)} → ${fmtTime(details.current_time)}` : formatHours(details.duration_minutes ?? 0)}
            </strong>
          </div>
          {details.delay_minutes != null && details.delay_minutes > 0 && (
            <div style={{ marginTop: 9, fontSize: 10.5, color: details.delay_minutes <= 5 ? T.amber : T.red }}>
              Retard calculé : {details.delay_minutes} min {details.delay_minutes <= 5 ? '(toléré)' : '(à vérifier si besoin)'}
            </div>
          )}
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: T.red, marginBottom: 10 }}>{error}</div>}

      {state === 'not_authorized' && (
        <input
          aria-label="Code de secours"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="Code de secours à 6 chiffres"
          style={{ ...inp, textAlign: 'center', fontSize: 20, fontWeight: 900, letterSpacing: 6, marginBottom: 10 }}
        />
      )}

      {(state === 'valid' || (state === 'not_authorized' && pin.length === 6)) && (
        <button
          onClick={confirm}
          disabled={busy}
          style={{ width: '100%', background: busy ? T.row : '#16a34a', color: busy ? T.mu : '#fff', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: busy ? 'not-allowed' : 'pointer' }}
        >
          {busy ? 'Validation…' : isStart ? 'Confirmer le début de mission' : 'Confirmer la fin de mission'}
        </button>
      )}
    </>,
  );
}
