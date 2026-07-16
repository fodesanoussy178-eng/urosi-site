import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { SignInForm } from '@/features/auth/SignInForm';
import { Logo } from '@/components/ui/Logo';
import { T, FONT, inp } from '@/components/ui/theme';
import { getWorkerValidationContext, validateMissionAttendance, type WorkerValidationContext } from './missionValidationService';

type BarcodeDetectorLike = { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

function extractQrCode(value: string): string | null {
  try {
    const url = new URL(value, window.location.origin);
    const match = url.pathname.match(/^\/valider\/([0-9a-f-]{36})$/i);
    return match?.[1] ?? null;
  } catch { return null; }
}

const messages: Record<string, string> = {
  invalid_identifier: 'QR ou identifiant de mission invalide.',
  application_not_found: 'Cette mission n’est pas liée à ton compte.',
  locked: 'Trop de tentatives. Réessaie dans 10 minutes.',
  invalid_attendance_state: 'Cette étape est déjà enregistrée ou le départ précède l’arrivée.',
  pin_expired: 'Le PIN a expiré. Demande le nouveau code affiché par l’employé.',
  invalid_pin: 'PIN incorrect.',
  manual_reason_required: 'Indique pourquoi le scan n’a pas fonctionné.',
};

export function WorkerAttendancePage() {
  const { qrCode: routeQr } = useParams<{ qrCode?: string }>();
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [qrCode, setQrCode] = useState(routeQr ?? '');
  const [missionCode, setMissionCode] = useState('');
  const [context, setContext] = useState<WorkerValidationContext | null>(null);
  const [pin, setPin] = useState('');
  const [manual, setManual] = useState(!routeQr);
  const [manualReason, setManualReason] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!session || (!qrCode && !missionCode)) return;
    getWorkerValidationContext({ qrCode: qrCode || null, missionCode: missionCode || null })
      .then((value) => { setContext(value); if (value.state !== 'ready') setError('Mission introuvable ou déjà terminée.'); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Lecture impossible.'));
  }, [session, qrCode, missionCode]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  async function startScanner() {
    setError(null);
    const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setManual(true);
      setError('Sur iPhone, utilise l’appareil photo du téléphone pour ouvrir le QR, ou saisis l’identifiant de secours.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream; setScanning(true);
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      const detector = new Detector({ formats: ['qr_code'] });
      const poll = async () => {
        if (!videoRef.current || !streamRef.current) return;
        const values = await detector.detect(videoRef.current).catch(() => []);
        const parsed = values[0] ? extractQrCode(values[0].rawValue) : null;
        if (parsed) {
          stream.getTracks().forEach((track) => track.stop()); streamRef.current = null; setScanning(false); setQrCode(parsed); navigate(`/valider/${parsed}`, { replace: true });
        } else window.setTimeout(poll, 250);
      };
      poll();
    } catch { setManual(true); setError('Caméra indisponible. Utilise l’identifiant de secours affiché sous le QR.'); }
  }

  async function confirm() {
    if (!context?.step || pin.length !== 6 || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await validateMissionAttendance({ qrCode: qrCode || null, missionCode: missionCode || null, pin, step: context.step, manualReason: manual ? manualReason : null });
      if (result.state === 'confirmed') setDone(true);
      else setError(`${messages[result.state] ?? 'Validation impossible.'}${result.remaining_attempts != null ? ` ${result.remaining_attempts} essai(s) restant(s).` : ''}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Validation impossible.'); }
    finally { setBusy(false); }
  }

  const shell = (content: React.ReactNode) => <main style={{ minHeight: '100dvh', background: T.bg, color: T.text, fontFamily: FONT, padding: 'calc(18px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom))', boxSizing: 'border-box' }}><div style={{ maxWidth: 420, margin: '0 auto' }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}><Logo sz={40} /><Link to="/app" style={{ color: T.sub, fontSize: 11, textDecoration: 'none' }}>Retour</Link></div>{content}</div></main>;

  if (authLoading) return shell(<div>Chargement…</div>);
  if (!session) return shell(<div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 15, padding: 16 }}><h1 style={{ fontSize: 17, margin: '0 0 6px' }}>Valider ma mission</h1><p style={{ color: T.sub, fontSize: 11, lineHeight: 1.5 }}>Connecte-toi : le QR restera ouvert après la connexion.</p><SignInForm /></div>);
  if (done) return shell(<div style={{ background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 16, padding: 22, textAlign: 'center' }}><div style={{ color: T.green, fontSize: 32 }}>✓</div><h1 style={{ fontSize: 19 }}>{context?.step === 'start' ? 'Mission démarrée' : 'Fin enregistrée'}</h1><p style={{ color: T.sub, fontSize: 11 }}>Validation horodatée. Tu peux fermer cet écran.</p><button onClick={() => navigate('/app')} style={{ width: '100%', minHeight: 48, border: 0, borderRadius: 11, background: '#fff', color: '#000', fontWeight: 900 }}>Revenir à mes missions</button></div>);

  return shell(<>
    <h1 style={{ fontSize: 20, margin: '0 0 5px' }}>{context?.step === 'end' ? 'Terminer la mission' : 'Démarrer la mission'}</h1>
    <p style={{ color: T.sub, fontSize: 11.5, lineHeight: 1.5, margin: '0 0 16px' }}>{context?.title ? `${context.title} · ${context.structure_name}` : 'Scanne le QR affiché par l’employé autorisé.'}</p>

    {!qrCode && !context && <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 15, padding: 15 }}>
      <button onClick={startScanner} style={{ width: '100%', minHeight: 52, border: 0, borderRadius: 11, background: T.grad, color: '#fff', fontWeight: 900, fontSize: 14 }}>Scanner le QR</button>
      {scanning && <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 12, marginTop: 12, background: '#000', maxHeight: 300 }} />}
      <button onClick={() => setManual(true)} style={{ width: '100%', marginTop: 9, minHeight: 44, borderRadius: 10, border: `1px solid ${T.cb}`, background: T.row, color: T.sub, fontWeight: 800 }}>Saisie de secours</button>
      {manual && <div style={{ marginTop: 12 }}><input aria-label="Identifiant de mission" value={missionCode} onChange={(event) => setMissionCode(event.target.value.toUpperCase())} placeholder="UROSI-XXXXXXXX" autoCapitalize="characters" style={inp} /><textarea aria-label="Motif de validation manuelle" value={manualReason} onChange={(event) => setManualReason(event.target.value)} placeholder="Pourquoi le QR ne fonctionne pas ?" rows={2} style={{ ...inp, marginTop: 8, resize: 'none' }} /></div>}
    </div>}

    {context?.state === 'ready' && <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 15, padding: 16 }}>
      <div style={{ color: T.green, fontSize: 10, fontWeight: 900, marginBottom: 5 }}>QR RECONNU</div>
      <div style={{ color: T.text, fontSize: 14, fontWeight: 900 }}>{context.title}</div>
      <div style={{ color: T.sub, fontSize: 10.5, margin: '3px 0 15px' }}>{context.structure_name} · {context.city}</div>
      <label style={{ display: 'block', color: T.sub, fontSize: 10, fontWeight: 800, marginBottom: 6 }}>PIN lu sur l’écran de l’employé</label>
      <input aria-label="PIN temporaire" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} autoFocus style={{ ...inp, textAlign: 'center', fontSize: 28, fontWeight: 900, letterSpacing: 8, padding: '14px 8px' }} />
      {manual && <textarea aria-label="Motif de validation manuelle" value={manualReason} onChange={(event) => setManualReason(event.target.value)} placeholder="Pourquoi le QR ne fonctionne pas ?" rows={2} style={{ ...inp, marginTop: 8, resize: 'none' }} />}
      <button disabled={busy || pin.length !== 6} onClick={confirm} style={{ width: '100%', minHeight: 52, marginTop: 12, border: 0, borderRadius: 11, background: pin.length === 6 ? '#16a34a' : T.row, color: pin.length === 6 ? '#fff' : T.mu, fontWeight: 900, fontSize: 14 }}>{busy ? 'Validation…' : context.step === 'start' ? 'Démarrer maintenant' : 'Terminer maintenant'}</button>
    </div>}
    {error && <div role="alert" style={{ marginTop: 10, color: T.red, background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 10, padding: 11, fontSize: 11, lineHeight: 1.45 }}>{error}</div>}
  </>);
}
