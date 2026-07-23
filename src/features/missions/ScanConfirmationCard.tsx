import { T, inp } from '@/components/ui/theme';
import { formatHours } from '@/lib/format';
import type { ScanContext } from './attendanceService';

function fmtTime(value?: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(value?: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export const scanStateCopy: Record<ScanContext['state'], { title: string; body: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
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

// Coeur de l'ecran de confirmation d'un pointage QR : partage exactement la
// meme logique (etats, code de secours, bouton de confirmation) entre la
// route publique /scan/:token (ouverte via l'appareil photo natif) et le
// scanner camera in-app cote structure (StructureQrScanSheet) — un seul
// endroit qui sait ce qu'un etat de scan signifie et permet de confirmer.
export function ScanConfirmationCard({
  ctx,
  error,
  busy,
  pin,
  onPinChange,
  onConfirm,
}: {
  ctx: ScanContext | null;
  error: string | null;
  busy: boolean;
  pin: string;
  onPinChange: (value: string) => void;
  onConfirm: () => void;
}) {
  const state = ctx?.state ?? 'invalid';
  const details = ctx;
  const copy = scanStateCopy[state];
  const color = copy.tone === 'ok' ? T.green : copy.tone === 'warn' ? T.amber : copy.tone === 'bad' ? T.red : T.sub;
  const bg = copy.tone === 'ok' ? T.greenBg : copy.tone === 'warn' ? T.amberBg : copy.tone === 'bad' ? T.redBg : T.row;
  const border = copy.tone === 'ok' ? T.greenBorder : copy.tone === 'warn' ? T.amberBorder : copy.tone === 'bad' ? T.redBorder : T.cb;
  const isStart = ctx?.type === 'start';

  return (
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
          onChange={(event) => onPinChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="Code de secours à 6 chiffres"
          style={{ ...inp, textAlign: 'center', fontSize: 20, fontWeight: 900, letterSpacing: 6, marginBottom: 10 }}
        />
      )}

      {(state === 'valid' || (state === 'not_authorized' && pin.length === 6)) && (
        <button
          onClick={onConfirm}
          disabled={busy}
          style={{ width: '100%', background: busy ? T.row : '#16a34a', color: busy ? T.mu : '#fff', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: busy ? 'not-allowed' : 'pointer' }}
        >
          {busy ? 'Validation…' : isStart ? 'Confirmer le début de mission' : 'Confirmer la fin de mission'}
        </button>
      )}
    </>
  );
}
