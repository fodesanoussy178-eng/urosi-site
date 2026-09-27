import { useEffect, useMemo, useState } from 'react';
import { sceneSvg } from '@/features/missions/categoryScene';
import { visualChainFor, type VisualSource } from '@/features/missions/missionVisual';
import type { FeedMission } from '@/features/missions/solidarityMissions';

type ArtMission = VisualSource & Pick<FeedMission, 'category' | 'key' | 'title'>;

// Visuel d'une mission, jamais vide. Hiérarchie : photo native > photo
// partenaire aux droits connus > logo de l'organisation > logo du domaine >
// illustration UROSI de la catégorie. Un logo est présenté comme un logo
// (médaillon sur l'illustration), jamais étiré comme une photo. Une image
// qui ne se charge pas passe au niveau suivant.
export function MissionArt({ mission }: { mission: ArtMission }) {
  const chain = useMemo(() => visualChainFor(mission), [mission]);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [chain]);
  const visual = chain[Math.min(index, chain.length - 1)]!;
  const next = () => setIndex((i) => i + 1);
  // Scène SVG statique générée par UROSI (aucune donnée utilisateur) : sûre.
  const scene = <div className="m-scene" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sceneSvg(mission.category, mission.key) }} />;

  if (visual.kind === 'photo' && visual.url) {
    return (
      <div className="m-art" data-visual={visual.level}>
        <img className="m-photo" src={visual.url} alt={`Photo de la mission « ${mission.title} »`} loading="lazy" onError={next} />
      </div>
    );
  }
  if (visual.kind === 'logo' && visual.url) {
    return (
      <div className="m-art m-art-logo" data-visual={visual.level}>
        {scene}
        <span className="m-logo-tile">
          <img src={visual.url} alt={visual.level === 'organization_logo' ? `Logo de ${mission.organization.name}` : ''} loading="lazy" onError={next} />
        </span>
      </div>
    );
  }
  return (
    <div className="m-art" data-visual="urosi_illustration">
      {scene}
    </div>
  );
}
