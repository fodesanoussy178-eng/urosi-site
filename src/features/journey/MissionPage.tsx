// Comportements 2 et 3 : je comprends la mission, je candidate chez
// l'annonceur. Une fiche simple — quoi, avec qui, où, quand, combien de
// temps — et un seul gros bouton.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PublicShell } from '@/components/public/PublicShell';
import { useAuth } from '@/features/auth/AuthContext';
import { applyToMission } from '@/features/missions/applicationsService';
import type { FeedMission } from '@/features/missions/solidarityMissions';
import { usePublicCatalog } from '@/features/participant/publicCatalog';
import { distanceKm } from '@/lib/geo';
import { describeError } from '@/lib/errors';
import { distanceLabel, durationLabel, hoursLabel, longDayLabel } from './format';
import { recordClick } from './journeyService';
import { readStoredLocation } from './location';
import { MissionGallery } from './MissionGallery';
import { addDays, rememberClick } from './visitor';

type CtaState = 'idle' | 'sent' | 'busy' | 'error';

function todayPlusWeek(): string {
  return addDays(new Date().toISOString().slice(0, 10), 7);
}

// Ouvre la page officielle de candidature. La fenêtre est ouverte dans le
// geste de l'utilisateur (sinon bloquée) ; l'enregistrement du clic ne
// retarde jamais la redirection de plus d'un instant et n'est jamais bloquant.
export async function openPartnerApplication(mission: FeedMission): Promise<void> {
  if (!mission.applicationUrl) return;
  const url = mission.applicationUrl;
  const win = typeof window.open === 'function' ? window.open('', '_blank') : null;
  rememberClick({
    key: mission.key,
    missionId: mission.id,
    title: mission.title,
    organization: mission.organization.name,
    askAfter: mission.date ?? todayPlusWeek(),
    clickedAt: new Date().toISOString(),
  });
  const recorded = recordClick(mission.id);
  if (win) {
    // Nouvel onglet : redirection immédiate, UROSI reste ouvert et termine
    // l'enregistrement du clic en parallèle.
    try {
      win.opener = null;
    } catch {
      // sans incidence
    }
    win.location.href = url;
    await recorded;
  } else {
    // Onglet bloqué : même onglet, après un bref délai pour enregistrer le clic.
    await Promise.race([recorded, new Promise((r) => setTimeout(r, 800))]);
    window.location.assign(url);
  }
}

function Cta({ mission, state, onApply, anonymous }: { mission: FeedMission; state: CtaState; onApply: () => void; anonymous: boolean }) {
  if (mission.isDemo) {
    return (
      <>
        <button type="button" className="pub-btn pub-btn-primary pub-btn-block j-cta" disabled>
          Mission d’exemple
        </button>
        <p className="j-cta-note">Cette fiche est un exemple : les vraies missions arrivent très bientôt.</p>
      </>
    );
  }
  const external = mission.kind === 'external_solidarity_mission';
  if (!external && state === 'sent') {
    return <p className="j-cta-done">✓ Candidature envoyée à {mission.organization.name}.</p>;
  }
  return (
    <>
      <button type="button" className="pub-btn pub-btn-primary pub-btn-block j-cta" onClick={onApply} disabled={state === 'busy'}>
        {external ? 'Candidater ↗' : 'Candidater'}
      </button>
      {external && <p className="j-cta-note">Tu continueras ta candidature sur le site de l’organisateur.</p>}
      {external && state === 'sent' && anonymous && (
        <p className="j-cta-note">
          <Link to="/inscription/participant">Créer mon profil pour suivre mes missions</Link>
        </p>
      )}
      {state === 'error' && <p className="j-cta-note" role="alert">Candidature impossible pour le moment. Réessaie dans un instant.</p>}
    </>
  );
}

export function MissionPage() {
  const { key = '' } = useParams();
  const nav = useNavigate();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { catalog, loading } = usePublicCatalog();
  const [state, setState] = useState<CtaState>('idle');
  const [error, setError] = useState<string | null>(null);
  const mission = useMemo(() => catalog?.missions.find((m) => m.key === decodeURIComponent(key)) ?? null, [catalog, key]);
  const here = useMemo(() => readStoredLocation(), []);

  async function apply() {
    if (!mission) return;
    if (mission.kind === 'external_solidarity_mission') {
      await openPartnerApplication(mission);
      setState('sent');
      return;
    }
    // Mission publiée sur UROSI : la structure doit savoir qui candidate.
    if (!userId) {
      nav(`/inscription/participant?next=${encodeURIComponent(`/missions/${key}`)}`);
      return;
    }
    setState('busy');
    try {
      await applyToMission(mission.id, userId);
      setState('sent');
    } catch (e) {
      const duplicate = (e as { code?: string }).code === '23505';
      setState(duplicate ? 'sent' : 'error');
      if (!duplicate) setError(describeError(e, 'ta candidature'));
    }
  }

  if (loading) {
    return (
      <PublicShell active="missions">
        <div className="pub-wrap j-page" aria-busy="true">
          <div className="pub-detail-visual" style={{ background: 'linear-gradient(90deg,#eef3fb,#f6f9fe,#eef3fb)' }} />
        </div>
      </PublicShell>
    );
  }

  if (!mission) {
    return (
      <PublicShell active="missions">
        <div className="pub-wrap j-page">
          <div className="j-empty">
            <p>Cette mission n’est plus disponible.</p>
            <Link className="pub-btn pub-btn-primary" to="/missions">Voir les missions</Link>
          </div>
        </div>
      </PublicShell>
    );
  }

  const distance = here && mission.coords ? distanceKm(here, mission.coords) : null;
  const place = [mission.address, mission.city].filter(Boolean).join(', ') || 'Lieu précisé par l’organisateur';
  const date = longDayLabel(mission.date);
  const hours = hoursLabel(mission.startTime, mission.endTime);
  const duration = durationLabel(mission.durationMinutes);

  return (
    <PublicShell active="missions">
      <div className="pub-wrap j-page">
        <Link to="/missions" className="j-back">← Missions</Link>
        <MissionGallery mission={mission} />
        <h1 className="j-mission-title">{mission.title}</h1>
        <div className="j-mission-org">{mission.organization.name}</div>

        <ul className="j-facts">
          <li>
            <span aria-hidden="true">📍</span>
            <span>{place}{distance != null ? ` · ${distanceLabel(distance)}` : ''}</span>
          </li>
          {(date || mission.scheduleText) && (
            <li>
              <span aria-hidden="true">📅</span>
              <span>{date ?? mission.scheduleText}</span>
            </li>
          )}
          {(hours || duration) && (
            <li>
              <span aria-hidden="true">🕘</span>
              <span>{[hours, duration].filter(Boolean).join(' · ')}</span>
            </li>
          )}
          {mission.places != null && mission.places > 0 && (
            <li>
              <span aria-hidden="true">👥</span>
              <span>{mission.places} place{mission.places > 1 ? 's' : ''}</span>
            </li>
          )}
        </ul>

        <h2 className="j-h2">Ce que tu vas faire</h2>
        <p className="j-description">{mission.description || 'L’organisateur précisera le déroulé de la mission.'}</p>

        <div className="j-cta-box">
          <Cta mission={mission} state={state} onApply={() => void apply()} anonymous={!userId} />
          {error && <p className="j-cta-note" role="alert">{error}</p>}
        </div>
      </div>
      <div className="pub-sticky-cta">
        <Cta mission={mission} state={state} onApply={() => void apply()} anonymous={!userId} />
      </div>
    </PublicShell>
  );
}
