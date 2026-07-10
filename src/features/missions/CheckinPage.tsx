import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { SignInForm } from '@/features/auth/SignInForm';
import { Logo } from '@/components/ui/Logo';
import { T, FONT } from '@/components/ui/theme';
import { confirmCheckin, fetchCheckinTarget, type CheckinTarget } from './applicationsService';

// Page ouverte en scannant le QR d'un travailleur avec un telephone.
// La validation n'aboutit que connectee au compte de la structure qui a
// publie la mission : la RLS refuse toute autre ecriture.
export function CheckinPage() {
  const { applicationId, token } = useParams<{ applicationId: string; token: string }>();
  const { session, loading: authLoading } = useAuth();
  const [target, setTarget] = useState<CheckinTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session || !applicationId || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchCheckinTarget(applicationId, token)
      .then(setTarget)
      .catch(() => setError('Erreur de chargement.'))
      .finally(() => setLoading(false));
  }, [session, applicationId, token]);

  async function validate() {
    if (!applicationId || !token || busy) return;
    setError(null);
    setBusy(true);
    try {
      await confirmCheckin(applicationId, token);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Validation impossible.');
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT, padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Logo sz={54} />
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 17 }}>{children}</div>
      </div>
    </div>
  );

  if (authLoading) return shell(<div style={{ fontSize: 12, color: T.mu, textAlign: 'center' }}>Chargement…</div>);

  if (!session) {
    return shell(
      <>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 4 }}>Validation de présence</div>
        <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5, marginBottom: 16 }}>
          Connecte-toi au compte de la structure qui a publié la mission pour valider la présence du travailleur.
        </div>
        <SignInForm />
      </>,
    );
  }

  if (loading) return shell(<div style={{ fontSize: 12, color: T.mu, textAlign: 'center' }}>Chargement…</div>);

  if (!target) {
    return shell(
      <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.6, textAlign: 'center' }}>
        Pointage introuvable.
        <br />
        Assure-toi d'être connecté au compte de la <strong style={{ color: T.text }}>structure qui a publié la mission</strong>, puis rescanne le QR.
      </div>,
    );
  }

  const isWorkerSelf = session.user.id === target.worker_id;
  const alreadyChecked = Boolean(target.checked_in_at) || done;

  return shell(
    <>
      <div style={{ fontSize: 15, fontWeight: 900, color: T.text, marginBottom: 3 }}>Validation de présence</div>
      <div style={{ fontSize: 11, color: T.mu, marginBottom: 14 }}>
        {target.mission?.title} · {target.mission?.city} · {target.mission?.scheduled_date}
      </div>
      <div style={{ background: T.row, borderRadius: 11, padding: '12px 13px', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{target.profile?.full_name || 'Travailleur'}</div>
        <div style={{ fontSize: 10, color: T.mu, marginTop: 2 }}>Candidature acceptée sur cette mission</div>
      </div>
      {alreadyChecked ? (
        <div style={{ background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 10, padding: '13px', textAlign: 'center', fontSize: 13, fontWeight: 800, color: T.green }}>
          ✓ Présence validée
          {target.checked_in_at && !done && (
            <div style={{ fontSize: 10, fontWeight: 600, color: T.sub, marginTop: 4 }}>
              le {new Date(target.checked_in_at).toLocaleString('fr')}
            </div>
          )}
        </div>
      ) : isWorkerSelf ? (
        <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.6, textAlign: 'center' }}>
          C'est ton propre QR : fais-le scanner par la personne de la structure présente sur place. Toi-même, tu ne peux pas valider ta présence.
        </div>
      ) : (
        <>
          {error && <div style={{ fontSize: 11, color: T.red, marginBottom: 10 }}>{error}</div>}
          <button
            onClick={validate}
            disabled={busy}
            style={{ width: '100%', background: busy ? T.row : '#16a34a', color: busy ? T.mu : '#fff', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: 'pointer' }}
          >
            {busy ? '…' : '✓ Valider la présence'}
          </button>
        </>
      )}
    </>,
  );
}
