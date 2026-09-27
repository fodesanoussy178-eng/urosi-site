// Fiche mission publique (/missions/:key) : éditoriale, claire, crédible.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { categoryInfo } from '@/features/missions/categories';
import { missionDistance, partnerLabel, type FeedMission } from '@/features/missions/solidarityMissions';
import { formatDistance, geocodeMelCity } from '@/lib/geo';
import { PublicShell } from '@/components/public/PublicShell';
import { MissionArt } from '@/components/public/MissionArt';
import { MissionBadgeRow, durationText } from '@/components/public/PublicMissionCard';
import { Icon } from '@/components/public/icons';
import { OrgLogo } from './ParticipantUi';
import { useFavorites } from './hooks';
import { usePublicCatalog } from './publicCatalog';

const LONG_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function longDate(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const label = LONG_DAY.format(d);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function Cta({ mission, onSignup }: { mission: FeedMission; onSignup: () => void }) {
  const partner = partnerLabel(mission);
  if (mission.isDemo) {
    return (
      <>
        <button type="button" className="pub-btn pub-btn-primary pub-btn-block" onClick={onSignup}>
          Créer mon compte
        </button>
        <p style={{ fontSize: 12.5, color: '#7b8aa1', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
          Cette fiche est un exemple. Crée ton compte pour être prévenu·e des premières missions réelles.
        </p>
      </>
    );
  }
  if (mission.kind === 'external_solidarity_mission' && mission.applicationUrl) {
    return (
      <>
        {/* Lien tracké officiel de l'API Engagement : le clic est compté puis
            redirigé vers la plateforme de l'annonceur. */}
        <a className="pub-btn pub-btn-primary pub-btn-block" href={mission.applicationUrl} target="_blank" rel="noopener noreferrer">
          Candidater <Icon name="external" size={16} />
        </a>
        <p style={{ fontSize: 12.5, color: '#7b8aa1', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
          Tu continueras ta candidature sur le site partenaire{partner ? ` (${partner})` : ''}.
          <br />
          <button type="button" onClick={onSignup} style={{ background: 'none', border: 'none', color: '#1d5fe6', fontWeight: 800, cursor: 'pointer', padding: 0, marginTop: 4, font: 'inherit' }}>
            Crée ton compte pour suivre ta candidature
          </button>
        </p>
      </>
    );
  }
  return (
    <>
      <button type="button" className="pub-btn pub-btn-primary pub-btn-block" onClick={onSignup}>
        Candidater
      </button>
      <p style={{ fontSize: 12.5, color: '#7b8aa1', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
        Crée ton compte gratuit en une minute : ta candidature est envoyée directement à la structure.
      </p>
    </>
  );
}

export function PublicMissionPage() {
  const { key = '' } = useParams();
  const nav = useNavigate();
  const { catalog, loading } = usePublicCatalog();
  const { favorites, toggleFavorite } = useFavorites(null);
  const [position] = useState(() => geocodeMelCity('Lille'));
  const mission = useMemo(() => catalog?.missions.find((m) => m.key === decodeURIComponent(key)) ?? null, [catalog, key]);
  const signup = () => nav('/inscription/participant');

  if (loading) {
    return (
      <PublicShell active="missions">
        <div className="pub-wrap" style={{ paddingTop: 40, color: '#7b8aa1' }}>Chargement de la mission…</div>
      </PublicShell>
    );
  }

  if (!mission) {
    return (
      <PublicShell active="missions">
        <div className="pub-wrap" style={{ paddingTop: 40 }}>
          <div className="pub-card" style={{ padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 19, fontWeight: 900 }}>Cette mission n’est plus disponible</div>
            <p className="pub-lede" style={{ fontSize: 14, marginTop: 6 }}>Elle a peut-être déjà trouvé ses bénévoles. D’autres missions t’attendent.</p>
            <Link className="pub-btn pub-btn-primary" to="/missions" style={{ marginTop: 16 }}>Voir les missions</Link>
          </div>
        </div>
      </PublicShell>
    );
  }

  const info = categoryInfo(mission.category);
  const distance = missionDistance(mission, position);
  const date = longDate(mission.date);
  const hours = mission.startTime && mission.endTime ? `${mission.startTime.replace(':', 'h')} – ${mission.endTime.replace(':', 'h')}` : mission.startTime ? `À partir de ${mission.startTime.replace(':', 'h')}` : null;
  const duration = durationText(mission.durationMinutes);
  const favorite = favorites.has(mission.key);
  const external = mission.kind === 'external_solidarity_mission';

  return (
    <PublicShell active="missions">
      <div className="pub-wrap pub-detail-page" style={{ paddingTop: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Link to="/missions" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: '#4a5a72', textDecoration: 'none' }}>
            <Icon name="arrowLeft" size={16} /> Retour aux missions
          </Link>
          <button type="button" aria-pressed={favorite} onClick={() => toggleFavorite(mission.key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#0f1f3a', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            <Icon name={favorite ? 'heartFill' : 'heart'} size={18} color="#e5484d" /> {favorite ? 'Dans tes favoris' : 'Ajouter aux favoris'}
          </button>
        </div>

        <div className="pub-detail">
          <article>
            <div className="pub-detail-visual">
              <MissionArt mission={mission} />
              {mission.isDemo && <span className="m-card-demo" style={{ position: 'absolute', top: 14, left: 14 }}>Exemple</span>}
            </div>
            <h1 className="pub-h1" style={{ marginTop: 22 }}>{mission.title}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 12px' }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', display: 'inline-flex', boxShadow: '0 2px 8px rgba(15,31,58,.12)' }}>
                <OrgLogo name={mission.organization.name} url={mission.organization.logoUrl} size={36} />
              </span>
              <span style={{ fontSize: 16, fontWeight: 800 }}>{mission.organization.name}</span>
              {mission.organization.verified && <span className="pub-badge pub-badge-green"><Icon name="check" size={12} /> Vérifiée</span>}
            </div>
            <MissionBadgeRow mission={mission} />

            <ul className="pub-facts" style={{ padding: 0 }}>
              <li><Icon name="pin" size={18} color="#1d5fe6" />{[mission.address, mission.city].filter(Boolean).join(', ') || 'Lieu communiqué par la structure'}{distance != null ? ` · ${formatDistance(distance)}` : ''}</li>
              {date && <li><Icon name="calendar" size={18} color="#1d5fe6" />{date}</li>}
              {(hours || duration) && <li><Icon name="clock" size={18} color="#1d5fe6" />{[hours, duration ? `(${duration})` : null].filter(Boolean).join(' ')}</li>}
              {!date && mission.scheduleText && <li><Icon name="clock" size={18} color="#1d5fe6" />{mission.scheduleText}</li>}
              {mission.places != null && mission.places > 0 && <li><Icon name="users" size={18} color="#1d5fe6" />{mission.places} place{mission.places > 1 ? 's' : ''} disponible{mission.places > 1 ? 's' : ''}</li>}
            </ul>

            <h2 style={{ fontSize: 19, fontWeight: 900, margin: '22px 0 8px' }}>À propos de la mission</h2>
            <p style={{ fontSize: 15.5, lineHeight: 1.7, color: '#33445e', whiteSpace: 'pre-line' }}>{mission.description || 'La structure précisera le déroulé de la mission.'}</p>

            <h2 style={{ fontSize: 19, fontWeight: 900, margin: '22px 0 10px' }}>Ce que tu vas mobiliser</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {info.skills.map((s) => <span key={s} className="pub-badge pub-badge-gray" style={{ fontSize: 13, padding: '6px 12px' }}>{s}</span>)}
            </div>
            <p style={{ fontSize: 13.5, color: '#7b8aa1', marginTop: 12 }}>Une fois la mission réalisée, elle rejoint ton parcours et ton CV UROSI.</p>
          </article>

          <aside className="pub-aside">
            <div className="pub-card pub-cta-card" style={{ padding: 20 }}>
              <Cta mission={mission} onSignup={signup} />
            </div>
            <div className="pub-card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#7b8aa1', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 }}>{external ? 'L’organisation' : 'La structure'}</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, overflow: 'hidden', display: 'inline-flex' }}>
                  <OrgLogo name={mission.organization.name} url={mission.organization.logoUrl} size={44} />
                </span>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 15 }}>{mission.organization.name}</div>
                  <div style={{ fontSize: 13, color: '#4a5a72' }}>
                    {external ? `Mission diffusée via ${partnerLabel(mission) ?? 'une plateforme partenaire'}` : mission.organization.verified ? 'Structure vérifiée par UROSI' : 'Structure en cours de vérification'}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 13.5, color: '#4a5a72', marginTop: 12 }}>{info.label}</div>
            </div>
          </aside>
        </div>
      </div>
      <div className="pub-sticky-cta">
        <Cta mission={mission} onSignup={signup} />
      </div>
    </PublicShell>
  );
}
