import { useState } from 'react';
import { T, inp } from '@/components/ui/theme';
import { partnerHost } from '@/features/missions/solidarityMissions';
import { formatDay } from '@/lib/slots';
import type { TimelineStep } from './journey';
import type { ExternalApplicationWithMission, ParticipantApplication } from './participantService';

export type TrackedApplication =
  | { origin: 'external'; app: ExternalApplicationWithMission }
  | { origin: 'urosi'; app: ParticipantApplication };

function stepDate(at: string | null): string | null {
  if (!at) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return formatDay(at);
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

const DOT: Record<TimelineStep['state'], { bg: string; border: string; glyph: string }> = {
  done: { bg: '#0891b2', border: '#0891b2', glyph: '✓' },
  current: { bg: '#f59e0b', border: '#f59e0b', glyph: '•' },
  upcoming: { bg: 'transparent', border: 'var(--urosi-border)', glyph: '' },
  stopped: { bg: 'transparent', border: 'var(--urosi-border)', glyph: '' },
};

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {steps.map((step, i) => {
        const dot = DOT[step.state];
        const last = i === steps.length - 1;
        const muted = step.state === 'upcoming' || step.state === 'stopped';
        return (
          <li key={step.key} style={{ display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 22, flexShrink: 0 }}>
              <span
                aria-hidden="true"
                style={{ width: 20, height: 20, borderRadius: '50%', background: dot.bg, border: `2px solid ${dot.border}`, color: '#fff', fontSize: 11, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: step.state === 'current' ? '0 0 0 4px rgba(245,158,11,.18)' : undefined }}
              >
                {dot.glyph}
              </span>
              {!last && <span aria-hidden="true" style={{ flex: 1, width: 2, minHeight: 18, background: step.state === 'done' ? '#0891b2' : T.cb, margin: '2px 0' }} />}
            </div>
            <div
              style={{
                flex: 1,
                marginBottom: last ? 0 : 12,
                background: step.state === 'current' ? T.amberBg : step.state === 'done' ? T.row : 'transparent',
                border: `1px solid ${step.state === 'current' ? T.amberBorder : step.state === 'done' ? T.cb : 'transparent'}`,
                borderRadius: 12,
                padding: step.state === 'upcoming' || step.state === 'stopped' ? '0 2px 4px' : '9px 11px',
                opacity: muted ? 0.62 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 900, color: T.text }}>{step.label}</span>
                {step.declared && step.state === 'done' && <span style={{ fontSize: 9, fontWeight: 800, color: T.mu, border: `1px solid ${T.cb}`, borderRadius: 999, padding: '1px 6px' }}>déclaré par toi</span>}
              </div>
              {stepDate(step.at) && step.state !== 'upcoming' && <div style={{ fontSize: 10, color: T.mu, marginTop: 2 }}>{stepDate(step.at)}</div>}
              <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5, marginTop: 3 }}>{step.description}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ApplicationTracker({
  tracked,
  steps,
  canRateStructure,
  onClose,
  onDeclare,
  onCancelNative,
  onMessage,
  onRate,
}: {
  tracked: TrackedApplication;
  steps: TimelineStep[];
  canRateStructure: boolean;
  onClose: () => void;
  onDeclare: (status: 'accepted_declared' | 'completed_declared' | 'withdrawn', minutes?: number | null) => Promise<void>;
  onCancelNative: () => Promise<void>;
  onMessage: () => void;
  onRate: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [askHours, setAskHours] = useState(false);
  const [hours, setHours] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  const title = tracked.app.mission?.title ?? 'Mission';
  const organization =
    tracked.origin === 'external'
      ? tracked.app.mission?.organization_name || 'Association partenaire'
      : tracked.app.mission?.structure?.trade_name || tracked.app.mission?.structure?.name || 'Structure';

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  const ext = tracked.origin === 'external' ? tracked.app : null;
  const native = tracked.origin === 'urosi' ? tracked.app : null;
  const host = ext ? partnerHost(ext.mission?.application_url ?? null) : null;
  const hoursValue = Number(hours.replace(',', '.'));
  const hoursOk = !hours || (Number.isFinite(hoursValue) && hoursValue > 0 && hoursValue <= 72);

  return (
    <div className="urosi-modal-layer" role="dialog" aria-modal="true" aria-label="Ma candidature" style={{ background: T.bg, overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 430, padding: 'calc(14px + env(safe-area-inset-top)) 16px 36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <button type="button" aria-label="Retour" onClick={onClose} style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${T.cb}`, background: T.card, color: T.text, fontSize: 16, cursor: 'pointer' }}>
            ‹
          </button>
          <div style={{ fontSize: 17, fontWeight: 900, color: T.text }}>Ma candidature</div>
        </div>

        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: T.text }}>{title}</div>
          <div style={{ fontSize: 11.5, color: T.sub, marginTop: 3 }}>{organization}</div>
          <div style={{ fontSize: 10.5, color: T.mu, marginTop: 5 }}>
            {ext ? `Candidature sur ${host ?? 'une plateforme partenaire'}` : 'Candidature directe sur UROSI'}
          </div>
        </div>

        <Timeline steps={steps} />

        <div style={{ display: 'grid', gap: 8, marginTop: 18 }}>
          {ext && ext.status === 'external_application_started' && (
            <button type="button" disabled={busy} onClick={() => run(() => onDeclare('accepted_declared'))} style={actionButton('primary')}>
              La structure m’a acceptée·e
            </button>
          )}
          {ext && ext.status === 'accepted_declared' && !askHours && (
            <button type="button" disabled={busy} onClick={() => setAskHours(true)} style={actionButton('primary')}>
              J’ai réalisé cette mission
            </button>
          )}
          {ext && askHours && (
            <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 12 }}>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 800, color: T.text, marginBottom: 6 }} htmlFor="declared-hours">
                Combien d’heures as-tu donné ? (facultatif)
              </label>
              <input id="declared-hours" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d,.]/g, ''))} inputMode="decimal" placeholder="Ex. 3" style={{ ...inp, marginBottom: 8 }} />
              {!hoursOk && <div style={{ fontSize: 10.5, color: T.red, marginBottom: 8 }}>Indique un nombre d’heures entre 0 et 72.</div>}
              <button
                type="button"
                disabled={busy || !hoursOk}
                onClick={() => run(() => onDeclare('completed_declared', hours ? Math.round(hoursValue * 60) : null))}
                style={actionButton('primary')}
              >
                Ajouter à mon parcours (déclarée)
              </button>
              <div style={{ fontSize: 10, color: T.mu, lineHeight: 1.5, marginTop: 8 }}>
                Elle apparaîtra comme « déclarée » jusqu’à sa vérification par UROSI.
              </div>
            </div>
          )}
          {ext && ext.mission?.application_url && ext.status !== 'verified' && ext.status !== 'withdrawn' && (
            <a href={ext.mission.application_url} target="_blank" rel="noopener noreferrer" style={{ ...actionButton('ghost'), textDecoration: 'none', textAlign: 'center' }}>
              Voir ma candidature sur {host ?? 'le site partenaire'} ↗
            </a>
          )}
          {ext && (ext.status === 'external_application_started' || ext.status === 'accepted_declared') && (
            <button type="button" disabled={busy} onClick={() => run(() => onDeclare('withdrawn'))} style={actionButton('link')}>
              Retirer de mon suivi
            </button>
          )}

          {native && native.conversation_status === 'open' && ['accepted', 'in_progress'].includes(native.status) && (
            <button type="button" onClick={onMessage} style={actionButton('ghost')}>
              💬 Écrire à la structure
            </button>
          )}
          {canRateStructure && (
            <button type="button" onClick={onRate} style={actionButton('primary')}>
              ★ Donner mon avis sur la structure
            </button>
          )}
          {native && ['pending', 'accepted'].includes(native.status) && !confirmCancel && (
            <button type="button" onClick={() => setConfirmCancel(true)} style={actionButton('link')}>
              Annuler ma candidature
            </button>
          )}
          {native && confirmCancel && (
            <div style={{ background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 11.5, color: T.text, marginBottom: 8 }}>La structure sera prévenue. Aucune conséquence pour toi.</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button type="button" onClick={() => setConfirmCancel(false)} style={actionButton('ghost')}>
                  Revenir
                </button>
                <button type="button" disabled={busy} onClick={() => run(onCancelNative)} style={{ ...actionButton('primary'), background: '#dc2626' }}>
                  Confirmer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function actionButton(kind: 'primary' | 'ghost' | 'link') {
  if (kind === 'link') return { background: 'none', border: 'none', color: T.mu, fontSize: 11.5, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', padding: '6px 0' } as const;
  return {
    display: 'block',
    width: '100%',
    background: kind === 'primary' ? T.grad : T.card,
    color: kind === 'primary' ? '#fff' : T.text,
    border: kind === 'primary' ? 'none' : `1px solid ${T.cb}`,
    borderRadius: 12,
    padding: '12px 0',
    fontSize: 13,
    fontWeight: 900,
    cursor: 'pointer',
  } as const;
}
