import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { T, FONT } from '@/components/ui/theme';
import { useBodyScrollLock } from '@/components/ui/useBodyScrollLock';
import { confirmAttendanceQR, fetchScanContext, type ScanContext } from './attendanceService';
import { ScanConfirmationCard } from './ScanConfirmationCard';

// Extrait le jeton d'un contenu de QR : soit l'URL complete UROSI
// (https://urosi.fr/scan/<token>), soit — au cas ou une douchette externe ou
// un lien colle ne fournirait que la partie finale — le jeton hexadecimal nu.
// Jamais de traitement du contenu scanne comme une commande : uniquement une
// extraction de motif.
export function extractScanToken(raw: string): string | null {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/scan\/([^/?#]+)/);
    if (match?.[1]) return match[1];
  } catch {
    // Pas une URL absolue : on retente comme jeton nu ci-dessous.
  }
  return /^[a-f0-9]{32,}$/i.test(trimmed) ? trimmed : null;
}

// Scanner camera in-app cote structure : le travailleur affiche son QR, la
// structure scanne depuis ce composant (jamais l'inverse — ce composant
// n'affiche jamais de QR appartenant a la structure). Reutilise exactement
// la meme logique de confirmation que /scan/:token (ScanConfirmationCard),
// simplement sans quitter l'application ni redemander de connexion.
export function StructureQrScanSheet({
  expectedMissionId,
  expectedMissionTitle,
  onClose,
  onConfirmed,
  onUsePin,
}: {
  expectedMissionId?: string;
  expectedMissionTitle?: string;
  onClose: () => void;
  onConfirmed: () => void;
  onUsePin: () => void;
}) {
  useBodyScrollLock(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scanningRef = useRef(false);
  const tokenRef = useRef<string | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ScanContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [mismatch, setMismatch] = useState(false);

  function stopCamera() {
    scanningRef.current = false;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function tick() {
    if (!scanningRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        if (g) {
          g.drawImage(video, 0, 0, w, h);
          const frame = g.getImageData(0, 0, w, h);
          const code = jsQR(frame.data, w, h);
          if (code?.data) {
            const token = extractScanToken(code.data);
            if (token) {
              handleDecoded(token);
              return;
            }
          }
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  async function startCamera() {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      scanningRef.current = true;
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setCameraError("Impossible d'accéder à la caméra sur cet appareil ou dans ce navigateur.");
    }
  }

  useEffect(() => {
    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDecoded(token: string) {
    stopCamera();
    tokenRef.current = token;
    setBusy(true);
    setError(null);
    try {
      const next = await fetchScanContext(token);
      setMismatch(Boolean(expectedMissionId && next.mission_id && next.mission_id !== expectedMissionId));
      setCtx(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'QR illisible.');
      setCtx({ state: 'invalid' });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!tokenRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirmAttendanceQR(tokenRef.current, pin || null);
      setCtx(result);
      onConfirmed();
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message === 'not_authorized') setError('Ce compte n’est pas reconnu comme validateur autorisé. Utilise le code de secours fourni par un responsable de la structure.');
      else if (message === 'invalid_pin') setError('Code de secours invalide ou expiré.');
      else setError(message || 'Validation impossible.');
    } finally {
      setBusy(false);
    }
  }

  function rescan() {
    tokenRef.current = null;
    setCtx(null);
    setError(null);
    setPin('');
    setMismatch(false);
    startCamera();
  }

  const scanning = !ctx && !cameraError;

  return (
    <div
      className="urosi-modal-layer urosi-bottom-sheet-layer"
      role="dialog"
      aria-modal="true"
      aria-label="Scanner un QR de pointage"
      style={{ background: 'rgba(0,0,0,.9)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: FONT }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', maxWidth: 430, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px calc(24px + env(safe-area-inset-bottom))', maxHeight: '92vh', overflowY: 'auto' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ color: T.text, fontSize: 16, fontWeight: 900 }}>Scanner un QR</div>
            {expectedMissionTitle && <div style={{ color: T.sub, fontSize: 11, marginTop: 2 }}>{expectedMissionTitle}</div>}
          </div>
          <button aria-label="Fermer" onClick={onClose} style={{ width: 32, height: 32, border: 0, borderRadius: 9, background: T.row, color: T.text, cursor: 'pointer', flexShrink: 0 }}>×</button>
        </div>

        {scanning && (
          <>
            <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 16, overflow: 'hidden', background: '#000' }}>
              <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: 24, border: '3px solid #22d3ee', borderRadius: 18, boxShadow: '0 0 0 9999px rgba(0,0,0,.35)' }} />
            </div>
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div style={{ fontSize: 11, color: T.sub, textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
              Vise le QR affiché sur le téléphone du travailleur.
            </div>
          </>
        )}

        {cameraError && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 11, color: T.red, background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 10, padding: 11, lineHeight: 1.5, marginBottom: 10 }}>
              {cameraError}
            </div>
            <div style={{ fontSize: 10.5, color: T.sub, lineHeight: 1.55, marginBottom: 12 }}>
              Solutions de secours : ouvre l’appareil photo natif de ton téléphone et vise le QR (le lien s’ouvre automatiquement), ou utilise un code de secours à 6 chiffres.
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <button onClick={startCamera} style={{ width: '100%', background: T.row, color: T.text, border: `1px solid ${T.cb}`, borderRadius: 10, padding: '11px 0', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                Réessayer la caméra
              </button>
              <button onClick={onUsePin} style={{ width: '100%', background: 'none', color: T.cyan, border: `1px solid ${T.cb}`, borderRadius: 10, padding: '11px 0', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                Utiliser un code de secours
              </button>
            </div>
          </div>
        )}

        {ctx && (
          <div style={{ marginTop: 4 }}>
            {mismatch && (
              <div style={{ fontSize: 10.5, color: T.amber, background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 10, padding: '9px 11px', marginBottom: 12, lineHeight: 1.45 }}>
                Ce QR appartient à une autre mission que celle ouverte. Vérifie avant de confirmer.
              </div>
            )}
            <ScanConfirmationCard ctx={ctx} error={error} busy={busy} pin={pin} onPinChange={setPin} onConfirm={confirm} />
            {ctx.state !== 'confirmed' && (
              <button onClick={rescan} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.mu, padding: '10px 0 0' }}>
                Scanner un autre QR
              </button>
            )}
            {ctx.state === 'confirmed' && (
              <button onClick={onClose} style={{ width: '100%', background: '#fff', color: '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer', marginTop: 12 }}>
                Fermer
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
