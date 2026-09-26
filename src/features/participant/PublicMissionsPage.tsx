// Catalogue public : « il y a déjà des choses que je peux faire autour de
// moi », avant même de créer un compte. Candidater demande un compte.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { T, FONT } from '@/components/ui/theme';
import { Logo } from '@/components/ui/Logo';
import { fetchSolidarityFeed, missionDistance, type FeedMission } from '@/features/missions/solidarityMissions';
import { useApproxPosition, useFavorites } from './hooks';
import { MissionBrowser } from './MissionBrowser';
import { MissionDetailSheet } from './MissionDetailSheet';

export function PublicMissionsPage() {
  const nav = useNavigate();
  const [feed, setFeed] = useState<FeedMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<FeedMission | null>(null);
  const { favorites, toggleFavorite } = useFavorites(null);
  const { position } = useApproxPosition(null);

  useEffect(() => {
    fetchSolidarityFeed()
      .then(setFeed)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT }}>
      <div style={{ width: '100%', maxWidth: 460, padding: 'calc(14px + env(safe-area-inset-top)) 14px 40px' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            <Logo sz={26} showWord={false} />
            <span style={{ fontSize: 15, fontWeight: 900, color: T.text }}>UROSI</span>
          </a>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => nav('/connexion')} style={{ background: 'transparent', border: `1px solid ${T.cb}`, color: T.text, borderRadius: 10, padding: '7px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              Connexion
            </button>
            <button type="button" onClick={() => nav('/acces')} style={{ background: T.grad, border: 'none', color: '#fff', borderRadius: 10, padding: '7px 12px', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>
              Créer un compte
            </button>
          </div>
        </header>
        <div style={{ fontSize: 11, fontWeight: 800, color: T.mu, letterSpacing: 0.4, textTransform: 'uppercase' }}>Missions solidaires · Métropole de Lille</div>
        <h1 style={{ fontSize: 25, fontWeight: 900, color: T.text, lineHeight: 1.15, margin: '6px 0 14px' }}>Des missions près de chez toi</h1>
        {failed ? (
          <div style={{ fontSize: 12, color: T.sub }}>Impossible de charger les missions pour le moment. Réessaie dans un instant.</div>
        ) : (
          <MissionBrowser missions={feed} loading={loading} position={position} favorites={favorites} onToggleFavorite={toggleFavorite} onOpen={setDetail} />
        )}
      </div>
      {detail && (
        <MissionDetailSheet
          mission={detail}
          distance={missionDistance(detail, position)}
          favorite={favorites.has(detail.key)}
          applyState="none"
          busy={false}
          anonymous
          onToggleFavorite={() => toggleFavorite(detail.key)}
          onClose={() => setDetail(null)}
          onApply={() => undefined}
          onSignup={() => nav('/inscription/participant')}
          onOpenTracking={() => undefined}
        />
      )}
    </div>
  );
}
