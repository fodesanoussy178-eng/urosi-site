import { categoryInfo } from '@/features/missions/categories';
import type { FeedMission } from '@/features/missions/solidarityMissions';
import { formatDistance } from '@/lib/geo';
import { useImpressionTracking } from '@/features/participant/impressionTracking';
import { OrgLogo } from '@/features/participant/ParticipantUi';
import { Icon } from './icons';
import { MissionArt } from './MissionArt';

const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

export function shortDate(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const label = DAY.format(d).replace('.', '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function durationText(minutes: number | null): string | null {
  if (!minutes) return null;
  const h = minutes / 60;
  if (h < 1) return `${minutes} min`;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1).replace('.', ',')} h`;
}

export function MissionBadgeRow({ mission }: { mission: FeedMission }) {
  const info = categoryInfo(mission.category);
  return (
    <div className="m-card-badges">
      <span className="pub-badge pub-badge-green">Solidaire</span>
      {mission.isShort && <span className="pub-badge pub-badge-blue">Mission courte</span>}
      {info.key !== 'autre' && <span className="pub-badge pub-badge-violet">{info.label}</span>}
      {mission.kind === 'external_solidarity_mission' && <span className="pub-badge pub-badge-gray">↗ Via {mission.partnerName ?? 'un partenaire'}</span>}
    </div>
  );
}

export function PublicMissionCard({
  mission,
  distance,
  favorite,
  onToggleFavorite,
  onOpen,
}: {
  mission: FeedMission;
  distance: number | null;
  favorite: boolean;
  onToggleFavorite: () => void;
  onOpen: () => void;
}) {
  const impressionRef = useImpressionTracking<HTMLElement>(mission.impressionUrl);
  const when = [shortDate(mission.date) ?? (mission.scheduleText ? mission.scheduleText : null), durationText(mission.durationMinutes)].filter(Boolean).join(' · ');
  const where = [mission.city, distance != null ? formatDistance(distance) : null].filter(Boolean).join(' · ');
  return (
    <article ref={impressionRef} className="m-card" data-mission-kind={mission.kind} data-demo={mission.isDemo ? 'true' : undefined}>
      <button type="button" className="m-card-hit" onClick={onOpen} aria-label={`Voir la mission ${mission.title}`} />
      <div className="m-card-visual">
        <MissionArt mission={mission} />
        {mission.isDemo && <span className="m-card-demo">Exemple</span>}
        <button
          type="button"
          className="m-card-heart"
          aria-pressed={favorite}
          aria-label={favorite ? `Retirer ${mission.title} des favoris` : `Ajouter ${mission.title} aux favoris`}
          onClick={onToggleFavorite}
          style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(15,31,58,.18)' }}
        >
          <Icon name={favorite ? 'heartFill' : 'heart'} size={17} color="#e5484d" />
        </button>
        <span className="m-card-logo">
          <OrgLogo name={mission.organization.name} url={mission.organization.logoUrl} size={32} />
        </span>
      </div>
      <div className="m-card-body">
        <div className="m-card-title">{mission.title}</div>
        <div className="m-card-org">{mission.organization.name}</div>
        <div className="m-card-meta">
          {when && <span><Icon name="calendar" size={14} />{when}</span>}
          {where && <span><Icon name="pin" size={14} />{where}</span>}
        </div>
        <MissionBadgeRow mission={mission} />
      </div>
    </article>
  );
}
