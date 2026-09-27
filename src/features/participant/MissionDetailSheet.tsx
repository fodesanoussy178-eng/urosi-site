import { T } from '@/components/ui/theme';
import { categoryInfo } from '@/features/missions/categories';
import { partnerLabel, type FeedMission } from '@/features/missions/solidarityMissions';
import { formatDistance } from '@/lib/geo';
import { Badge, HeartButton, MissionBadges, MissionVisual, OrgLogo, durationLabel, whenLabel } from './ParticipantUi';

export type ApplyState = 'none' | 'applied';

export function MissionDetailSheet({
  mission,
  distance,
  favorite,
  applyState,
  busy,
  anonymous,
  onToggleFavorite,
  onClose,
  onApply,
  onSignup,
  onOpenTracking,
}: {
  mission: FeedMission;
  distance: number | null;
  favorite: boolean;
  applyState: ApplyState;
  busy: boolean;
  anonymous: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  onApply: () => void;
  onSignup: () => void;
  onOpenTracking: () => void;
}) {
  const external = mission.kind === 'external_solidarity_mission';
  const host = partnerLabel(mission);
  const duration = durationLabel(mission.durationMinutes);
  const info = categoryInfo(mission.category);

  return (
    <div className="urosi-modal-layer urosi-bottom-sheet-layer" style={{ background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div
        className="urosi-bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Fiche mission : ${mission.title}`}
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 430, background: T.card, borderRadius: '22px 22px 0 0', overflow: 'hidden', maxHeight: '92dvh', display: 'flex', flexDirection: 'column' }}
      >
        <MissionVisual mission={mission} height={176} radius={0}>
          <button type="button" aria-label="Fermer" onClick={onClose} style={{ position: 'absolute', top: 12, left: 12, width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.94)', color: '#0f172a', fontSize: 16, fontWeight: 900, cursor: 'pointer' }}>
            ‹
          </button>
          <div style={{ position: 'absolute', top: 12, right: 12 }}>
            <HeartButton active={favorite} onToggle={onToggleFavorite} label={mission.title} />
          </div>
        </MissionVisual>

        <div style={{ padding: '16px 16px 22px', overflowY: 'auto' }}>
          <div style={{ fontSize: 19, fontWeight: 900, color: T.text, lineHeight: 1.2, marginBottom: 8 }}>{mission.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <OrgLogo name={mission.organization.name} url={mission.organization.logoUrl} size={22} />
            <span style={{ fontSize: 12.5, fontWeight: 800, color: T.sub }}>{mission.organization.name}</span>
            {mission.organization.verified && <Badge tone="green">✓ Structure vérifiée</Badge>}
          </div>

          <div style={{ display: 'grid', gap: 7, fontSize: 12, color: T.sub, marginBottom: 12 }}>
            <div>📍 {[mission.address, mission.city].filter(Boolean).join(', ') || 'Lieu communiqué par la structure'}{distance != null ? ` · ${formatDistance(distance)}` : ''}</div>
            <div>📅 {whenLabel(mission)}{duration ? ` · ${duration}` : ''}</div>
            {mission.scheduleText && mission.date && <div>🕒 {mission.scheduleText}</div>}
            {mission.places != null && mission.places > 0 && <div>👥 {mission.places} place{mission.places > 1 ? 's' : ''} disponible{mission.places > 1 ? 's' : ''}</div>}
          </div>

          <div style={{ marginBottom: 14 }}>
            <MissionBadges mission={mission} />
          </div>

          <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, marginBottom: 5 }}>Description</div>
          <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: 12 }}>
            {mission.description || 'La structure précisera le déroulé de la mission.'}
          </div>

          <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, marginBottom: 6 }}>Ce que tu mobiliseras</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 18 }}>
            {info.skills.map((skill) => (
              <Badge key={skill} tone="neutral">{skill}</Badge>
            ))}
          </div>

          {anonymous ? (
            <>
              <button type="button" onClick={onSignup} style={primaryButton(false)}>
                Créer mon compte pour candidater
              </button>
              <div style={noteStyle}>Gratuit, en une minute. Ton parcours commence dès ta première mission.</div>
            </>
          ) : applyState === 'applied' ? (
            <>
              <button type="button" onClick={onOpenTracking} style={secondaryButton}>
                Suivre ma candidature →
              </button>
              {external && mission.applicationUrl && (
                <a href={mission.applicationUrl} target="_blank" rel="noopener noreferrer" style={{ ...noteStyle, display: 'block', color: T.cyan, fontWeight: 800 }}>
                  Rouvrir la candidature sur {host ?? 'le site partenaire'} ↗
                </a>
              )}
            </>
          ) : (
            <>
              <button type="button" onClick={onApply} disabled={busy} style={primaryButton(busy)}>
                {busy ? '…' : external ? 'Candidater ↗' : 'Candidater'}
              </button>
              <div style={noteStyle}>
                {external
                  ? `Tu continueras ta candidature sur le site partenaire${host ? ` (${host})` : ''}. UROSI garde une trace pour t’aider à la suivre.`
                  : 'Ta candidature est envoyée directement à la structure. Tu seras prévenu·e de sa réponse.'}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function primaryButton(busy: boolean) {
  return {
    width: '100%',
    background: T.grad,
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    padding: '14px 0',
    fontSize: 14.5,
    fontWeight: 900,
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.7 : 1,
  } as const;
}

const secondaryButton = {
  width: '100%',
  background: T.row,
  color: T.text,
  border: `1px solid ${T.cb}`,
  borderRadius: 12,
  padding: '13px 0',
  fontSize: 13.5,
  fontWeight: 900,
  cursor: 'pointer',
} as const;

const noteStyle = { fontSize: 10.5, color: T.mu, textAlign: 'center', lineHeight: 1.5, marginTop: 8 } as const;
