// Espace participant — phase 0 (missions solidaires).
// découvrir → candidater → suivre → participer → le parcours grandit.
// Remplace WorkerApp tant que la couche rémunérée est en sommeil ; WorkerApp
// n'est ni modifié ni supprimé.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { T, FONT, inp } from '@/components/ui/theme';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ChatSheet } from '@/components/ui/ChatSheet';
import { Logo } from '@/components/ui/Logo';
import { useBodyScrollLock } from '@/components/ui/useBodyScrollLock';
import { WorkerSettingsSheet } from '@/features/worker/WorkerSettingsSheet';
import { applyToMission, updateApplicationStatus } from '@/features/missions/applicationsService';
import { fetchPendingRatingRequests, rate, type RatingRequest } from '@/features/missions/ratingsService';
import { INTEREST_OPTIONS, type SolidarityCategory } from '@/features/missions/categories';
import { fetchSolidarityFeed, missionDistance, sortFeed, type FeedMission } from '@/features/missions/solidarityMissions';
import { describeError } from '@/lib/errors';
import {
  declareExternalApplication,
  fetchMyExternalApplications,
  fetchMyRatings,
  fetchParticipantApplications,
  recordExternalApplication,
  removeAvatar,
  saveInterests,
  uploadAvatar,
  type ExternalApplicationWithMission,
  type ParticipantApplication,
  type ParticipantRating,
} from './participantService';
import { buildExperiences, externalHeadline, externalTimeline, nativeHeadline, nativeTimeline, summarize } from './journey';
import { useApproxPosition, useFavorites } from './hooks';
import { CategoryChips, MissionBrowser, SearchField } from './MissionBrowser';
import { MissionDetailSheet } from './MissionDetailSheet';
import { ApplicationTracker, type TrackedApplication } from './ApplicationTracker';
import { Avatar, Badge, EmptyState, FeedMissionCard } from './ParticipantUi';
import { ApplicationRow, ExperienceItem, FullScreen, MenuRow, ParcoursView, ProfileHeader, ReviewsView, SectionLabel, SkillsAndDomains } from './ProfileViews';

type Tab = 'accueil' | 'missions' | 'favoris' | 'profil';
type ProfileScreen = 'parcours' | 'candidatures' | 'avis' | 'cv' | null;

const NAV: Array<[Tab, string, string]> = [
  ['accueil', '⌂', 'Accueil'],
  ['missions', '◎', 'Missions'],
  ['favoris', '♡', 'Favoris'],
  ['profil', '◯', 'Profil'],
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ParticipantApp() {
  const { session, profile, refreshProfile } = useAuth();
  const userId = session?.user.id ?? null;
  const [tab, setTab] = useState<Tab>('accueil');
  const [screen, setScreen] = useState<ProfileScreen>(null);
  const [feed, setFeed] = useState<FeedMission[]>([]);
  const [nativeApps, setNativeApps] = useState<ParticipantApplication[]>([]);
  const [externalApps, setExternalApps] = useState<ExternalApplicationWithMission[]>([]);
  const [ratings, setRatings] = useState<ParticipantRating[]>([]);
  const [ratingRequests, setRatingRequests] = useState<RatingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<FeedMission | null>(null);
  const [tracked, setTracked] = useState<TrackedApplication | null>(null);
  const [chatFor, setChatFor] = useState<ParticipantApplication | null>(null);
  const [rateFor, setRateFor] = useState<ParticipantApplication | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [homeQuery, setHomeQuery] = useState('');
  const [homeCategory, setHomeCategory] = useState<SolidarityCategory | 'all'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const { favorites, toggleFavorite } = useFavorites(userId);
  const { position } = useApproxPosition(profile?.city);
  useBodyScrollLock(Boolean(detail || tracked || chatFor || rateFor || screen));

  const firstName = (profile?.public_first_name || profile?.full_name || '').trim().split(/\s+/)[0] || '';
  const displayName = firstName || 'Toi';
  const interests = profile?.interests ?? [];

  function notif(message: string) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  }

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [missions, natives, externals, myRatings, requests] = await Promise.all([
        fetchSolidarityFeed(),
        fetchParticipantApplications(userId),
        fetchMyExternalApplications(userId),
        fetchMyRatings(userId).catch(() => [] as ParticipantRating[]),
        fetchPendingRatingRequests(userId).catch(() => [] as RatingRequest[]),
      ]);
      setFeed(missions);
      setNativeApps(natives);
      setExternalApps(externals);
      setRatings(myRatings);
      setRatingRequests(requests);
    } catch (e) {
      notif(describeError(e, 'le chargement des missions'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Centres d'intérêt choisis à l'inscription (avant confirmation de
  // l'email, donc avant l'existence d'une session) : reportés une seule fois.
  useEffect(() => {
    const meta = session?.user.user_metadata?.interests;
    if (!userId || !profile || (profile.interests ?? []).length > 0 || !Array.isArray(meta) || meta.length === 0) return;
    saveInterests(userId, meta.filter((v): v is string => typeof v === 'string').slice(0, 8))
      .then(() => refreshProfile())
      .catch(() => undefined);
  }, [userId, profile, session, refreshProfile]);

  const appliedKeys = useMemo(() => {
    const keys = new Set<string>();
    externalApps.filter((a) => a.status !== 'withdrawn').forEach((a) => keys.add(`external:${a.external_mission_id}`));
    nativeApps.filter((a) => a.status !== 'cancelled').forEach((a) => keys.add(`urosi:${a.mission_id}`));
    return keys;
  }, [externalApps, nativeApps]);

  const experiences = useMemo(() => buildExperiences(nativeApps, externalApps, ratings), [nativeApps, externalApps, ratings]);
  const summary = useMemo(() => summarize(experiences, ratings, profile?.skills ?? []), [experiences, ratings, profile?.skills]);

  const trackedList = useMemo(() => {
    const t = today();
    const items = [
      ...externalApps.map((app) => ({
        key: `external:${app.id}`,
        at: app.clicked_at,
        title: app.mission?.title ?? 'Mission solidaire',
        subtitle: app.mission?.organization_name || 'Plateforme partenaire',
        headline: externalHeadline(app, t),
        open: { origin: 'external', app } as TrackedApplication,
        active: app.status === 'external_application_started' || app.status === 'accepted_declared',
      })),
      ...nativeApps.map((app) => ({
        key: `urosi:${app.id}`,
        at: app.created_at,
        title: app.mission?.title ?? 'Mission',
        subtitle: app.mission?.structure?.trade_name || app.mission?.structure?.name || 'Structure UROSI',
        headline: nativeHeadline(app),
        open: { origin: 'urosi', app } as TrackedApplication,
        active: ['pending', 'accepted', 'in_progress'].includes(app.status),
      })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }, [externalApps, nativeApps]);
  const activeCount = trackedList.filter((i) => i.active).length;

  const ratedByMe = useMemo(() => new Set(ratings.filter((r) => r.direction === 'worker_to_structure').map((r) => r.application_id)), [ratings]);
  const ratingDue = useMemo(
    () =>
      nativeApps.filter(
        (a) => ratingRequests.some((r) => r.applicationId === a.id && r.direction === 'worker_to_structure') && !ratedByMe.has(a.id),
      ),
    [nativeApps, ratingRequests, ratedByMe],
  );

  async function apply(mission: FeedMission) {
    if (!userId || busy) return;
    if (mission.kind === 'external_solidarity_mission') {
      if (!mission.applicationUrl) return;
      // Fenêtre ouverte dans le geste de l'utilisateur (sinon bloquée), puis
      // redirigée seulement une fois la candidature enregistrée dans UROSI.
      const win = typeof window.open === 'function' ? window.open('', '_blank') : null;
      setBusy(true);
      try {
        await recordExternalApplication(userId, mission.id, mission.source);
      } catch (e) {
        win?.close();
        notif(describeError(e, 'l’enregistrement de ta candidature'));
        setBusy(false);
        return;
      }
      if (win) {
        try {
          win.opener = null;
        } catch {
          // navigateur qui refuse : sans incidence
        }
        win.location.href = mission.applicationUrl;
      } else {
        window.location.assign(mission.applicationUrl);
      }
      notif('Candidature ouverte sur le site partenaire. Suis-la depuis « Mes candidatures ».');
      setBusy(false);
      setDetail(null);
      await load();
      return;
    }
    setBusy(true);
    try {
      await applyToMission(mission.id, userId);
      notif('✓ Candidature envoyée à la structure');
      setDetail(null);
      await load();
    } catch (e) {
      notif(describeError(e, 'l’envoi de ta candidature'));
    } finally {
      setBusy(false);
    }
  }

  function openTrackingFor(mission: FeedMission) {
    const item =
      mission.kind === 'external_solidarity_mission'
        ? externalApps.find((a) => a.external_mission_id === mission.id)
        : nativeApps.find((a) => a.mission_id === mission.id && a.status !== 'cancelled');
    if (!item) return;
    setDetail(null);
    setTracked(mission.kind === 'external_solidarity_mission' ? { origin: 'external', app: item as ExternalApplicationWithMission } : { origin: 'urosi', app: item as ParticipantApplication });
  }

  function refreshTracked(ext: ExternalApplicationWithMission[], nat: ParticipantApplication[]) {
    setTracked((current) => {
      if (!current) return current;
      if (current.origin === 'external') {
        const next = ext.find((a) => a.id === current.app.id);
        return next ? { origin: 'external', app: next } : null;
      }
      const next = nat.find((a) => a.id === current.app.id);
      return next ? { origin: 'urosi', app: next } : null;
    });
  }

  async function reloadAndRefreshTracked() {
    if (!userId) return;
    const [ext, nat] = await Promise.all([fetchMyExternalApplications(userId), fetchParticipantApplications(userId)]);
    setExternalApps(ext);
    setNativeApps(nat);
    refreshTracked(ext, nat);
  }

  const favoriteMissions = useMemo(() => sortFeed(feed.filter((m) => favorites.has(m.key)), position), [feed, favorites, position]);
  const homeMissions = useMemo(() => {
    const q = homeQuery.trim().toLowerCase();
    const list = feed.filter((m) => (homeCategory === 'all' || m.category === homeCategory) && (!q || `${m.title} ${m.organization.name} ${m.city ?? ''}`.toLowerCase().includes(q)));
    return sortFeed(list, position).slice(0, 6);
  }, [feed, homeCategory, homeQuery, position]);

  const card = (m: FeedMission) => (
    <FeedMissionCard key={m.key} mission={m} distance={missionDistance(m, position)} favorite={favorites.has(m.key)} onToggleFavorite={() => toggleFavorite(m.key)} onOpen={() => setDetail(m)} />
  );

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT }}>
      <div style={{ width: '100%', maxWidth: 430, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <header style={{ padding: 'calc(14px + env(safe-area-inset-top)) 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Logo sz={26} showWord={false} />
            <span style={{ fontSize: 15, fontWeight: 900, color: T.text, letterSpacing: 0.3 }}>UROSI</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThemeToggle />
            {userId && <NotificationBell profileId={userId} onDataChanged={() => void load()} />}
          </div>
        </header>

        {toast && (
          <div role="status" style={{ margin: '0 14px 8px', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 10, padding: '8px 12px', fontSize: 11.5, color: T.sub }}>
            {toast}
          </div>
        )}

        <main style={{ padding: '4px 14px calc(96px + env(safe-area-inset-bottom))', flex: 1 }}>
          {tab === 'accueil' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: T.sub }}>Bonjour {firstName ? `${firstName} ` : ''}! 👋</div>
                <h1 style={{ fontSize: 23, fontWeight: 900, color: T.text, lineHeight: 1.15, marginTop: 4 }}>Des missions solidaires près de chez toi</h1>
              </div>
              <SearchField value={homeQuery} onChange={setHomeQuery} />
              <CategoryChips value={homeCategory} onChange={setHomeCategory} available={new Set(feed.map((m) => m.category))} first={interests} />

              {ratingDue.length > 0 && (
                <button type="button" onClick={() => setRateFor(ratingDue[0] ?? null)} style={{ textAlign: 'left', background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 14, padding: '11px 13px', cursor: 'pointer' }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: T.amber }}>★ Ton avis compte</div>
                  <div style={{ fontSize: 11.5, color: T.text, marginTop: 2 }}>Comment s’est passée « {ratingDue[0]?.mission?.title ?? 'ta mission'} » ?</div>
                </button>
              )}

              {activeCount > 0 && (
                <button type="button" onClick={() => setScreen('candidatures')} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: '11px 13px', cursor: 'pointer' }}>
                  <span aria-hidden="true" style={{ fontSize: 18 }}>📬</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 900, color: T.text }}>Mes candidatures</span>
                    <span style={{ display: 'block', fontSize: 11, color: T.sub }}>{activeCount} en cours de suivi</span>
                  </span>
                  <span aria-hidden="true" style={{ color: T.mu }}>›</span>
                </button>
              )}

              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 2 }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: T.text }}>Près de chez toi</div>
                <span style={{ fontSize: 10.5, color: T.cyan, fontWeight: 800 }}>📍 {profile?.city || 'Lille et alentours'}</span>
              </div>
              {loading && <div style={{ fontSize: 11.5, color: T.mu, textAlign: 'center', padding: 18 }}>Chargement des missions…</div>}
              {!loading && homeMissions.length === 0 && (
                <EmptyState icon="🌱" title={feed.length === 0 ? 'Les premières missions arrivent' : 'Aucune mission ne correspond'}>
                  {feed.length === 0 ? 'De nouvelles missions solidaires sont ajoutées très régulièrement autour de Lille.' : 'Essaie une autre catégorie ou un autre mot-clé.'}
                </EmptyState>
              )}
              {homeMissions.map(card)}
              {feed.length > homeMissions.length && (
                <button type="button" onClick={() => setTab('missions')} style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '12px 0', color: T.text, fontSize: 12.5, fontWeight: 900, cursor: 'pointer' }}>
                  Voir toutes les missions ({feed.length}) →
                </button>
              )}

              <button type="button" onClick={() => setTab('profil')} style={{ textAlign: 'left', background: T.grad, border: 'none', borderRadius: 16, padding: '14px 15px', cursor: 'pointer', color: '#fff' }}>
                <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.85 }}>Mon parcours</div>
                <div style={{ fontSize: 15, fontWeight: 900, marginTop: 3 }}>
                  {summary.missions > 0 ? `${summary.missions} expérience${summary.missions > 1 ? 's' : ''} vérifiée${summary.missions > 1 ? 's' : ''}` : 'Ton CV grandit avec l’expérience'}
                </div>
                <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>Chaque mission réalisée rejoint ton parcours →</div>
              </button>
            </div>
          )}

          {tab === 'missions' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <h1 style={{ fontSize: 23, fontWeight: 900, color: T.text }}>Missions</h1>
                <span style={{ fontSize: 11, color: T.cyan, fontWeight: 800 }}>📍 Lille et alentours</span>
              </div>
              <MissionBrowser missions={feed} loading={loading} position={position} favorites={favorites} onToggleFavorite={toggleFavorite} onOpen={setDetail} interests={interests} />
            </div>
          )}

          {tab === 'favoris' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <h1 style={{ fontSize: 23, fontWeight: 900, color: T.text }}>Favoris</h1>
              {favoriteMissions.length === 0 ? (
                <EmptyState icon="♡" title="Aucun favori pour l’instant">
                  Touche le cœur d’une mission pour la retrouver ici.
                </EmptyState>
              ) : (
                favoriteMissions.map(card)
              )}
            </div>
          )}

          {tab === 'profil' && (
            <div>
              <h1 style={{ fontSize: 23, fontWeight: 900, color: T.text, marginBottom: 12 }}>Mon profil</h1>
              <ProfileHeader name={displayName} city={profile?.city ?? null} avatarUrl={profile?.avatar_url ?? null} summary={summary} onEdit={() => setShowSettings(true)} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                <button type="button" onClick={() => setScreen('parcours')} style={{ background: T.text, color: T.bg, border: 'none', borderRadius: 12, padding: '12px 0', fontSize: 12.5, fontWeight: 900, cursor: 'pointer' }}>
                  Voir mon parcours
                </button>
                <button type="button" onClick={() => setScreen('cv')} style={{ background: T.card, color: T.text, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '12px 0', fontSize: 12.5, fontWeight: 900, cursor: 'pointer' }}>
                  Télécharger mon CV
                </button>
              </div>
              <SkillsAndDomains summary={summary} />
              <SectionLabel>Mes expériences</SectionLabel>
              {experiences.length === 0 ? (
                <div style={{ fontSize: 11.5, color: T.mu, lineHeight: 1.5 }}>Tes missions réalisées apparaîtront ici.</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {experiences.slice(0, 3).map((e) => (
                    <ExperienceItem key={e.key} experience={e} />
                  ))}
                </div>
              )}
              <div style={{ marginTop: 16, borderBottom: `1px solid ${T.cb}` }}>
                <MenuRow icon="🧭" label="Mon parcours" hint={`${experiences.length}`} onClick={() => setScreen('parcours')} />
                <MenuRow icon="📬" label="Mes candidatures" hint={activeCount ? `${activeCount} en cours` : undefined} onClick={() => setScreen('candidatures')} />
                <MenuRow icon="★" label="Mes avis" hint={ratingDue.length ? `${ratingDue.length} à donner` : undefined} onClick={() => setScreen('avis')} />
                <MenuRow icon="📄" label="Mon CV" onClick={() => setScreen('cv')} />
                <MenuRow icon="⚙" label="Paramètres" onClick={() => setShowSettings(true)} />
              </div>
            </div>
          )}
        </main>

        <nav aria-label="Navigation principale" style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, zIndex: 40, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, padding: '7px 10px calc(10px + env(safe-area-inset-bottom))', background: T.bg, borderTop: `1px solid ${T.cb}`, boxShadow: '0 -10px 28px rgba(0,0,0,.12)' }}>
          {NAV.map(([key, icon, label]) => {
            const on = tab === key;
            return (
              <button key={key} type="button" aria-current={on ? 'page' : undefined} onClick={() => setTab(key)} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 0', borderRadius: 12, border: 'none', cursor: 'pointer', background: on ? T.row : 'transparent', color: on ? T.cyan : T.mu }}>
                <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>{key === 'favoris' && on ? '♥' : icon}</span>
                <span style={{ fontSize: 10.5, fontWeight: 800 }}>{label}</span>
                {key === 'profil' && ratingDue.length > 0 && <span aria-hidden="true" style={{ position: 'absolute', top: 5, right: '30%', width: 7, height: 7, borderRadius: '50%', background: '#f59e0b' }} />}
              </button>
            );
          })}
        </nav>

        {detail && (
          <MissionDetailSheet
            mission={detail}
            distance={missionDistance(detail, position)}
            favorite={favorites.has(detail.key)}
            applyState={appliedKeys.has(detail.key) ? 'applied' : 'none'}
            busy={busy}
            anonymous={false}
            onToggleFavorite={() => toggleFavorite(detail.key)}
            onClose={() => setDetail(null)}
            onApply={() => void apply(detail)}
            onSignup={() => undefined}
            onOpenTracking={() => openTrackingFor(detail)}
          />
        )}

        {screen === 'candidatures' && (
          <FullScreen title="Mes candidatures" onBack={() => setScreen(null)}>
            {trackedList.length === 0 ? (
              <EmptyState icon="📬" title="Aucune candidature pour l’instant">
                Trouve une mission près de chez toi et candidate en un geste.
              </EmptyState>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {trackedList.map((item) => (
                  <ApplicationRow key={item.key} title={item.title} subtitle={item.subtitle} headline={item.headline} onOpen={() => setTracked(item.open)} />
                ))}
              </div>
            )}
          </FullScreen>
        )}

        {screen === 'parcours' && (
          <FullScreen title="Mon parcours" onBack={() => setScreen(null)}>
            <ParcoursView experiences={experiences} summary={summary} />
          </FullScreen>
        )}

        {screen === 'avis' && (
          <FullScreen title="Mes avis" onBack={() => setScreen(null)}>
            <ReviewsView
              ratings={ratings}
              missionTitle={(id) => nativeApps.find((a) => a.id === id)?.mission?.title ?? 'Mission'}
              pendingToGive={ratingDue.map((a) => ({ applicationId: a.id, title: a.mission?.title ?? 'Mission', onRate: () => setRateFor(a) }))}
            />
          </FullScreen>
        )}

        {screen === 'cv' && (
          <CvScreen
            name={(profile?.full_name || displayName).trim()}
            city={profile?.city ?? null}
            bio={profile?.bio ?? null}
            avatarUrl={profile?.avatar_url ?? null}
            onBack={() => setScreen(null)}
            onError={(m) => notif(m)}
            experiences={experiences}
            summary={summary}
          />
        )}

        {tracked && (
          <ApplicationTracker
            tracked={tracked}
            steps={tracked.origin === 'external' ? externalTimeline(tracked.app, today()) : nativeTimeline(tracked.app, today())}
            canRateStructure={tracked.origin === 'urosi' && ratingDue.some((a) => a.id === tracked.app.id)}
            onClose={() => setTracked(null)}
            onDeclare={async (status, minutes) => {
              if (tracked.origin !== 'external') return;
              try {
                await declareExternalApplication(tracked.app.id, status, minutes);
                await reloadAndRefreshTracked();
                notif(status === 'withdrawn' ? 'Candidature retirée de ton suivi.' : status === 'completed_declared' ? 'Ajoutée à ton parcours (déclarée).' : 'C’est noté !');
                if (status === 'withdrawn') setTracked(null);
              } catch (e) {
                notif(describeError(e, 'la mise à jour de ta candidature'));
              }
            }}
            onCancelNative={async () => {
              if (tracked.origin !== 'urosi') return;
              try {
                await updateApplicationStatus(tracked.app.id, 'cancelled');
                await reloadAndRefreshTracked();
                notif('Candidature annulée. La structure est prévenue.');
              } catch (e) {
                notif(describeError(e, 'l’annulation'));
              }
            }}
            onMessage={() => tracked.origin === 'urosi' && setChatFor(tracked.app)}
            onRate={() => tracked.origin === 'urosi' && setRateFor(tracked.app)}
          />
        )}

        {chatFor && userId && (
          <ChatSheet applicationId={chatFor.id} myId={userId} title={chatFor.mission?.title ?? 'Mission'} onClose={() => setChatFor(null)} />
        )}

        {rateFor && userId && rateFor.mission && (
          <RateStructureSheet
            title={rateFor.mission.title}
            organization={rateFor.mission.structure?.trade_name || rateFor.mission.structure?.name || 'la structure'}
            onClose={() => setRateFor(null)}
            onSubmit={async (score, comment) => {
              try {
                await rate({ applicationId: rateFor.id, structureId: rateFor.mission!.structure_id, workerId: userId, score, direction: 'worker_to_structure', comment });
                setRateFor(null);
                notif('Merci ! Ton avis sera visible une fois que la structure aura répondu (ou après quelques jours).');
                await load();
              } catch (e) {
                notif(describeError(e, 'l’envoi de ton avis'));
              }
            }}
          />
        )}

        {showSettings && session && (
          <WorkerSettingsSheet
            session={session}
            profile={profile}
            onClose={() => setShowSettings(false)}
            onProfileSaved={refreshProfile}
            extraTop={
              <PhotoAndInterests
                name={displayName}
                avatarUrl={profile?.avatar_url ?? null}
                interests={interests}
                onUpload={async (file) => {
                  if (!userId) return;
                  await uploadAvatar(userId, file);
                  await refreshProfile();
                }}
                onRemove={async () => {
                  if (!userId) return;
                  await removeAvatar(userId);
                  await refreshProfile();
                }}
                onSaveInterests={async (next) => {
                  if (!userId) return;
                  await saveInterests(userId, next);
                  await refreshProfile();
                }}
              />
            }
          />
        )}
      </div>
    </div>
  );
}

function CvScreen({
  name,
  city,
  bio,
  avatarUrl,
  experiences,
  summary,
  onBack,
  onError,
}: {
  name: string;
  city: string | null;
  bio: string | null;
  avatarUrl: string | null;
  experiences: ReturnType<typeof buildExperiences>;
  summary: ReturnType<typeof summarize>;
  onBack: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const { downloadCvPdf } = await import('./cvPdf');
      await downloadCvPdf({ name, city, bio }, summary, experiences);
    } catch (e) {
      onError(describeError(e, 'la création de ton CV'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FullScreen title="Mon CV" onBack={onBack}>
      <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 15, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar name={name} url={avatarUrl} size={52} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: T.text }}>{name}</div>
            <div style={{ fontSize: 11.5, color: T.sub }}>{[city, 'Parcours UROSI'].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        {bio && <div style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.5, marginTop: 10 }}>{bio}</div>}
        <div style={{ fontSize: 11, color: T.mu, lineHeight: 1.5, marginTop: 10 }}>
          Ton CV reprend tes expériences vérifiées (badge ✓), puis, à part, celles que tu as déclarées et qui attendent une vérification.
        </div>
      </div>
      <button type="button" onClick={download} disabled={busy} style={{ width: '100%', background: T.grad, color: '#fff', border: 'none', borderRadius: 12, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: busy ? 'wait' : 'pointer', marginBottom: 14 }}>
        {busy ? 'Préparation…' : 'Télécharger mon CV (PDF)'}
      </button>
      <SkillsAndDomains summary={summary} />
      <SectionLabel>Expériences</SectionLabel>
      <ParcoursView experiences={experiences} summary={summary} />
    </FullScreen>
  );
}

function RateStructureSheet({ title, organization, onClose, onSubmit }: { title: string; organization: string; onClose: () => void; onSubmit: (score: number, comment: string) => Promise<void> }) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="urosi-modal-layer urosi-bottom-sheet-layer" role="dialog" aria-modal="true" aria-label="Donner mon avis" style={{ background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div className="urosi-bottom-sheet" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 430, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 26px' }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: T.text }}>Comment s’est passée la mission ?</div>
        <div style={{ fontSize: 11.5, color: T.sub, margin: '4px 0 14px' }}>
          « {title} » avec {organization}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n} étoile${n > 1 ? 's' : ''}`} aria-pressed={score === n} onClick={() => setScore(n)} style={{ flex: 1, padding: '11px 0', fontSize: 22, borderRadius: 10, cursor: 'pointer', color: '#f59e0b', background: score != null && n <= score ? T.amberBg : T.row, border: `1px solid ${score != null && n <= score ? T.amberBorder : T.cb}` }}>
              ★
            </button>
          ))}
        </div>
        <textarea aria-label="Commentaire (facultatif)" value={comment} onChange={(e) => setComment(e.target.value.slice(0, 280))} rows={3} placeholder="Un mot sur l’accueil, l’organisation… (facultatif)" style={{ ...inp, resize: 'none', lineHeight: 1.5 }} />
        <button
          type="button"
          disabled={score == null || busy}
          onClick={async () => {
            if (score == null) return;
            setBusy(true);
            try {
              await onSubmit(score, comment.trim());
            } finally {
              setBusy(false);
            }
          }}
          style={{ width: '100%', background: score == null ? T.row : T.grad, color: score == null ? T.mu : '#fff', border: 'none', borderRadius: 12, padding: '12px 0', fontSize: 13, fontWeight: 900, cursor: score == null ? 'not-allowed' : 'pointer', marginTop: 4 }}
        >
          {busy ? '…' : 'Envoyer mon avis'}
        </button>
        <button type="button" onClick={onClose} style={{ width: '100%', background: 'none', border: 'none', color: T.mu, fontSize: 11.5, marginTop: 8, cursor: 'pointer' }}>
          Plus tard
        </button>
      </div>
    </div>
  );
}

function PhotoAndInterests({
  name,
  avatarUrl,
  interests,
  onUpload,
  onRemove,
  onSaveInterests,
}: {
  name: string;
  avatarUrl: string | null;
  interests: string[];
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
  onSaveInterests: (interests: string[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(interests);
  const dirty = selected.slice().sort().join(',') !== interests.slice().sort().join(',');

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(success);
    } catch (e) {
      setMessage(describeError(e, 'cette mise à jour'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar name={name} url={avatarUrl} size={56} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text }}>Photo de profil</div>
          <div style={{ fontSize: 10.5, color: T.mu, lineHeight: 1.45, marginTop: 2 }}>Recommandée, jamais obligatoire. Sans photo, un avatar est généré.</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 7 }}>
            <label style={{ fontSize: 11.5, fontWeight: 800, color: T.cyan, cursor: busy ? 'wait' : 'pointer' }}>
              {avatarUrl ? 'Changer' : 'Ajouter une photo'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Choisir une photo de profil"
                disabled={busy}
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void run(() => onUpload(file), 'Photo mise à jour ✓');
                }}
              />
            </label>
            {avatarUrl && (
              <button type="button" disabled={busy} onClick={() => void run(onRemove, 'Photo retirée.')} style={{ background: 'none', border: 'none', color: T.mu, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                Retirer
              </button>
            )}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, margin: '14px 0 7px' }}>Centres d’intérêt <span style={{ color: T.mu, fontWeight: 700, fontSize: 10.5 }}>(facultatif)</span></div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {INTEREST_OPTIONS.map((c) => {
          const on = selected.includes(c.key);
          return (
            <button key={c.key} type="button" aria-pressed={on} onClick={() => setSelected((prev) => (on ? prev.filter((k) => k !== c.key) : [...prev, c.key]))} style={{ border: `1px solid ${on ? T.cyan : T.cb}`, background: on ? 'rgba(34,211,238,.12)' : T.row, color: on ? T.cyan : T.sub, borderRadius: 999, padding: '6px 11px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
              {c.glyph} {c.label}
            </button>
          );
        })}
      </div>
      {dirty && (
        <button type="button" disabled={busy} onClick={() => void run(() => onSaveInterests(selected), 'Centres d’intérêt enregistrés ✓')} style={{ width: '100%', marginTop: 10, background: T.text, color: T.bg, border: 'none', borderRadius: 10, padding: '10px 0', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>
          Enregistrer mes centres d’intérêt
        </button>
      )}
      {message && <div style={{ fontSize: 11, color: T.sub, marginTop: 8 }}>{message}</div>}
      <div style={{ marginTop: 10 }}>
        <Badge tone="neutral">Aucun document d’identité demandé</Badge>
      </div>
    </div>
  );
}
