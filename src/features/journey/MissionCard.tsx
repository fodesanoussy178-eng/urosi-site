import { MissionArt } from '@/components/public/MissionArt';
import type { FeedMission } from '@/features/missions/solidarityMissions';
import { useImpressionTracking } from '@/features/participant/impressionTracking';
import { dayLabel, distanceLabel, durationLabel } from './format';

// Carte mission : photo, titre, structure, distance, date, durée. Rien d'autre.
export function MissionCard({ mission, distance, onOpen }: { mission: FeedMission; distance: number | null; onOpen: () => void }) {
  const impressionRef = useImpressionTracking<HTMLElement>(mission.impressionUrl);
  const when = [dayLabel(mission.date) ?? (mission.scheduleText ? 'Dates flexibles' : null), durationLabel(mission.durationMinutes)].filter(Boolean).join(' · ');
  const where = distanceLabel(distance) ?? mission.city;
  return (
    <article ref={impressionRef} className="m-card j-card" data-mission-kind={mission.kind}>
      <button type="button" className="m-card-hit" onClick={onOpen} aria-label={`Voir la mission ${mission.title}`} />
      <div className="m-card-visual">
        <MissionArt mission={mission} />
        {mission.isDemo && <span className="m-card-demo">Exemple</span>}
      </div>
      <div className="m-card-body j-card-body">
        <div className="m-card-title">{mission.title}</div>
        <div className="m-card-org">{mission.organization.name}</div>
        <div className="j-card-meta">
          {where && <span>📍 {where}</span>}
          {when && <span>{when}</span>}
        </div>
      </div>
    </article>
  );
}

export function MissionCardSkeleton() {
  return (
    <div className="m-card" aria-hidden="true">
      <div className="m-card-visual" style={{ background: 'linear-gradient(90deg,#eef3fb,#f6f9fe,#eef3fb)' }} />
      <div className="m-card-body j-card-body">
        <div style={{ height: 16, width: '75%', borderRadius: 6, background: '#eef3fb' }} />
        <div style={{ height: 12, width: '45%', borderRadius: 6, background: '#f1f5fb' }} />
        <div style={{ height: 12, width: '60%', borderRadius: 6, background: '#f1f5fb' }} />
      </div>
    </div>
  );
}
