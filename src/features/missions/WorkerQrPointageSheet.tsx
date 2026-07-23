import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { QRBadge } from '@/components/ui/QRBadge';
import { T, FONT } from '@/components/ui/theme';
import { useBodyScrollLock } from '@/components/ui/useBodyScrollLock';
import { createAttendanceQR, type CreatedAttendanceQR } from '@/features/missions/attendanceService';
import type { QRTokenType } from '@/types/database.types';

// QR de pointage affiche par le TRAVAILLEUR : gros bouton rond, fond jaune
// tres visible, QR noir au centre. La structure le scanne et confirme de son
// cote (voir StructureScanPage) ; ce composant se ferme tout seul des que la
// confirmation arrive (Realtime sur applications), sans action supplementaire
// du travailleur.
export function WorkerQrPointageSheet({
  applicationId,
  step,
  missionTitle,
  onClose,
  onConfirmed,
}: {
  applicationId: string;
  step: QRTokenType;
  missionTitle?: string;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  useBodyScrollLock(true);
  const [qr, setQr] = useState<CreatedAttendanceQR | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const generating = useRef(false);

  const generate = useCallback(async () => {
    if (generating.current) return;
    generating.current = true;
    setError(null);
    try {
      const next = await createAttendanceQR(applicationId, step);
      setQr(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'QR indisponible.');
    } finally {
      generating.current = false;
    }
  }, [applicationId, step]);

  useEffect(() => {
    generate();
  }, [generate]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Regenere automatiquement un nouveau jeton des que l'ancien expire (10 min) :
  // le travailleur n'a jamais a cliquer pour rafraichir le QR.
  const secondsLeft = qr ? Math.max(0, Math.ceil((new Date(qr.expires_at).getTime() - now) / 1000)) : 0;
  useEffect(() => {
    if (qr && secondsLeft === 0) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  // La structure confirme depuis un autre appareil : cet ecran se ferme tout
  // seul, sans que le travailleur ait quoi que ce soit a faire.
  useEffect(() => {
    const channel = supabase
      .channel(`attendance-confirm:${applicationId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'applications', filter: `id=eq.${applicationId}` },
        (payload) => {
          const row = payload.new as { actual_start_at?: string | null; actual_end_at?: string | null };
          if ((step === 'start' && row.actual_start_at) || (step === 'end' && row.actual_end_at)) {
            onConfirmed();
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, step]);

  const origin = window.location.origin;

  return (
    <div
      className="urosi-modal-layer urosi-bottom-sheet-layer"
      role="dialog"
      aria-modal="true"
      aria-label={step === 'start' ? 'QR de debut de mission' : 'QR de fin de mission'}
      style={{ background: 'rgba(0,0,0,.86)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', maxWidth: 380, background: T.card, borderRadius: 22, padding: '22px 18px', textAlign: 'center' }}
        onClick={(event) => event.stopPropagation()}
      >
        <button aria-label="Fermer" onClick={onClose} style={{ float: 'right', width: 32, height: 32, border: 0, borderRadius: 9, background: T.row, color: T.text, cursor: 'pointer' }}>×</button>
        <div style={{ fontSize: 16, fontWeight: 900, color: T.text, marginBottom: 2 }}>
          {step === 'start' ? 'Démarrer la mission' : 'Terminer la mission'}
        </div>
        {missionTitle && <div style={{ fontSize: 11, color: T.sub, marginBottom: 18 }}>{missionTitle}</div>}

        <div
          style={{
            width: 260,
            height: 260,
            margin: '0 auto 14px',
            borderRadius: '50%',
            background: 'linear-gradient(145deg,#facc15,#f59e0b)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 30px #f59e0b40',
          }}
        >
          <div style={{ width: 196, height: 196, background: '#fff', borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {qr ? (
              <QRBadge value={`${origin}/scan/${qr.token}`} size={176} />
            ) : (
              <div style={{ fontSize: 11, color: '#00000080' }}>{error ? 'Erreur' : 'Génération…'}</div>
            )}
          </div>
        </div>

        <div style={{ fontSize: 11, color: T.sub, marginBottom: 6 }}>
          Présente ce QR à un responsable de la structure pour qu'il le scanne
        </div>
        {qr && (
          <div style={{ fontSize: 10, color: secondsLeft > 60 ? T.mu : T.amber, fontWeight: 700 }}>
            {secondsLeft > 0 ? `Valable ${Math.floor(secondsLeft / 60)} min ${String(secondsLeft % 60).padStart(2, '0')} s` : 'Renouvellement…'}
          </div>
        )}
        {error && (
          <div role="alert" style={{ marginTop: 10, color: T.red, background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 10, padding: 11, fontSize: 11, lineHeight: 1.45 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
