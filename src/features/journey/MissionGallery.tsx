import { useEffect, useState } from 'react';
import { MissionArt } from '@/components/public/MissionArt';
import { fetchMissionImages } from '@/features/missions/missionImagesService';
import type { FeedMission } from '@/features/missions/solidarityMissions';

// Photos d'une mission native : la principale en grand, les autres en
// vignettes. Sans photo, le visuel suit la hiérarchie commune (MissionArt).
export function MissionGallery({ mission }: { mission: FeedMission }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const nativeId = mission.kind === 'urosi_solidarity_mission' && !mission.isDemo ? mission.id : null;
  useEffect(() => {
    if (!nativeId) return;
    let alive = true;
    fetchMissionImages(nativeId)
      .then((images) => {
        if (alive) setPhotos(images.map((i) => i.image_url));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [nativeId]);

  const current = photos[selected];
  return (
    <>
      <div className="pub-detail-visual">
        {current ? (
          <div className="m-art" data-visual="native_photo">
            <img className="m-photo" src={current} alt={`Photo ${selected + 1} de la mission « ${mission.title} »`} />
          </div>
        ) : (
          <MissionArt mission={mission} />
        )}
        {mission.isDemo && <span className="m-card-demo" style={{ position: 'absolute', top: 14, left: 14 }}>Exemple</span>}
      </div>
      {photos.length > 1 && (
        <div className="pub-gallery" role="group" aria-label="Photos de la mission">
          {photos.map((url, i) => (
            <button key={url} type="button" aria-pressed={i === selected} aria-label={`Voir la photo ${i + 1}`} onClick={() => setSelected(i)}>
              <img src={url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

