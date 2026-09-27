import { useState } from 'react';
import { sceneSvg } from '@/features/missions/categoryScene';
import type { FeedMission } from '@/features/missions/solidarityMissions';

// Visuel d'une mission, jamais vide : photo de mission > illustration de la
// source > scène UROSI de la catégorie. Une image cassée passe au niveau suivant.
export function MissionArt({ mission }: { mission: Pick<FeedMission, 'imageUrl' | 'illustrationUrl' | 'category' | 'key'> }) {
  const candidates = [mission.imageUrl, mission.illustrationUrl].filter((u): u is string => Boolean(u));
  const [failed, setFailed] = useState(0);
  const src = candidates[failed];
  if (src) {
    const illustration = src === mission.illustrationUrl && src !== mission.imageUrl;
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed((n) => n + 1)}
        style={illustration ? { objectFit: 'contain', background: '#fff', padding: 18, boxSizing: 'border-box' } : undefined}
      />
    );
  }
  // Contenu statique généré par nous (aucune donnée utilisateur) : sûr.
  return <div className="m-scene" dangerouslySetInnerHTML={{ __html: sceneSvg(mission.category, mission.key) }} />;
}
