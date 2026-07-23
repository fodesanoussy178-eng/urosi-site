import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { signOut } from '@/features/auth/authService';
import { submitWorkerKyc, updateProfile, uploadIdentityDocument, type Profile } from '@/features/profile/profileService';
import { T, FONT, inp } from '@/components/ui/theme';
import { Fld } from '@/components/ui/Fld';
import { Stars } from '@/components/ui/Stars';
import { DocModal, AideRegles, type DocKey } from '@/components/ui/DocModal';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ChatSheet } from '@/components/ui/ChatSheet';
import { useBodyScrollLock } from '@/components/ui/useBodyScrollLock';
import { WalletCard } from '@/components/ui/WalletCard';
import { PricingDetails } from '@/components/ui/PricingDetails';
import {
  fetchOpenMissions,
  subscribeToMissionFeed,
  unsubscribeMissionFeed,
  type MissionWithStructure,
} from '@/features/missions/missionsService';
import {
  applyToMission,
  updateApplicationStatus,
  fetchMyApplications,
  subscribeToMyApplicationsFeed,
  unsubscribeApplicationsFeed,
  type ApplicationWithMission,
} from '@/features/missions/applicationsService';
import {
  rate,
  fetchStructureRatings,
  fetchStructureReviews,
  fetchWorkerReceivedRatings,
  fetchRatedApplicationIds,
  fetchPendingRatingRequests,
  snoozeRatingRequest,
  shouldPromptRatingRequest,
  type StructureRating,
  type StructureReview,
  type RatingRequest,
} from '@/features/missions/ratingsService';
import { notifyDelay } from '@/features/missions/feedbackService';
import {
  attendanceEventLabel,
  fetchAttendanceEvents,
  reportMissionIssue,
  type AttendanceEvent,
} from '@/features/missions/attendanceService';
import { WorkerQrPointageSheet } from '@/features/missions/WorkerQrPointageSheet';
import type { QRTokenType, CvStatus } from '@/types/database.types';
import { fetchUnreadCounts } from '@/features/messages/messagesService';
import { fetchMySpotOffers, respondToSpotOffer, type SpotOffer } from '@/features/missions/spotOffersService';
import { fetchWorkerStats, type WorkerStats } from '@/features/stats/statsService';
import { fetchCommissionRates, type CommissionRates } from '@/features/pricing/pricingService';
import { PriceSplit } from '@/components/ui/PriceSplit';
import { splitPrice } from '@/features/pricing/priceSplit';
import { distanceKm, formatDistance, type LatLng } from '@/lib/geo';
import { formatDay, groupByDay } from '@/lib/slots';
import { formatEuros, formatHours } from '@/lib/format';

type Tab = 'flux' | 'moi' | 'profil';

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

function missionPriceTotalCents(mission: MissionWithStructure): number {
  const generatedTotal = Number(mission.price_total);
  if (Number.isFinite(generatedTotal) && (generatedTotal > 0 || mission.is_solidaire)) {
    return Math.round(generatedTotal * 100);
  }
  return mission.worker_rate_cents;
}

const SHEET = { background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1200 } as const;
const SHEET_BODY = { width: '100%', maxWidth: 430, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 28px' } as const;
type ProfileUpdate = Parameters<typeof updateProfile>[1];

const WORKER_REPORT_MOTIFS: Record<string, string> = {
  structure_absent: 'Aucun responsable présent',
  closed_place: 'Établissement fermé',
  wrong_address: 'Adresse incorrecte',
  conditions_differentes: "Conditions différentes de l'annonce",
  task_unplanned: 'Tâche non prévue',
  hours_changed: 'Horaires modifiés',
  inappropriate_behavior: 'Comportement inapproprié',
  danger: 'Danger ou sécurité',
  discrimination: 'Discrimination',
  harcelement: 'Harcèlement',
  missing_equipment: 'Matériel absent',
  break_not_respected: 'Pause non respectée',
  overtime_request: 'Demande de rester plus longtemps',
  other: 'Autre',
};

function isKycReady(profile: Profile | null | undefined): boolean {
  return profile?.kyc_status === 'submitted' || profile?.kyc_status === 'verified';
}

function kycBadge(profile: Profile | null | undefined): { label: string; color: string; bg: string } {
  if (profile?.kyc_status === 'verified') return { label: 'KYC vérifié', color: T.green, bg: T.greenBg };
  if (profile?.kyc_status === 'submitted') return { label: 'KYC envoyé', color: T.cyan, bg: '#22d3ee15' };
  if (profile?.kyc_status === 'rejected') return { label: 'KYC à reprendre', color: T.red, bg: T.redBg };
  return { label: 'Après acceptation', color: T.amber, bg: T.amberBg };
}

const SECTOR_LABELS: Record<string, string> = {
  restauration: 'Restauration',
  vente: 'Vente',
  logistique: 'Logistique',
  evenementiel: 'Événementiel',
  nettoyage: 'Nettoyage',
  manutention: 'Manutention',
  administratif: 'Administratif',
  autre: 'Autre',
};

function completedMissionCategories(applications: ApplicationWithMission[]): Array<[string, number]> {
  const counts = applications.reduce<Record<string, number>>((result, application) => {
    const sector = application.mission?.sector ?? 'autre';
    const label = SECTOR_LABELS[sector] ?? sector;
    result[label] = (result[label] ?? 0) + 1;
    return result;
  }, {});
  return Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'fr'));
}

function normalizeIban(value: string): string {
  return value.replace(/\s/g, '').toUpperCase();
}

// Offre de place : compte à rebours isolé dans son propre composant pour que
// le tic par seconde ne re-rende pas tout l'écran. IMPORTANT : le travailleur
// ne doit jamais savoir qu'une file d'attente existe — le message reste
// « mission disponible », sans mention de place libérée ni de rang.
function SpotOfferBanner({ offer, busy, onRespond }: { offer: SpotOffer; busy: boolean; onRespond: (accept: boolean) => void }) {
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.floor((new Date(offer.expires_at).getTime() - Date.now()) / 1000)));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft(Math.max(0, Math.floor((new Date(offer.expires_at).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [offer.expires_at]);

  const expired = secondsLeft <= 0;
  return (
    <div role="status" style={{ margin: '8px 12px 0', background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 12, padding: 13 }}>
      <div style={{ color: T.amber, fontSize: 11, fontWeight: 900 }}>Mission disponible pour toi</div>
      <div style={{ color: T.text, fontSize: 13, fontWeight: 800, marginTop: 3 }}>{offer.mission_title}</div>
      <div style={{ color: T.sub, fontSize: 10.5, marginTop: 2 }}>
        {offer.city ?? ''}{offer.scheduled_date ? ` · ${formatDay(offer.scheduled_date)}` : ''}{offer.start_time ? ` · ${offer.start_time.slice(0, 5)}` : ''}
      </div>
      <div style={{ color: expired ? T.red : T.sub, fontSize: 10.5, fontWeight: 800, margin: '6px 0 9px' }}>
        {expired ? 'Délai de confirmation dépassé.' : `Confirme ta participation dans les ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}
      </div>
      {!expired && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button disabled={busy} onClick={() => onRespond(true)} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>
            Je participe
          </button>
          <button disabled={busy} onClick={() => onRespond(false)} style={{ background: T.row, color: T.sub, border: `1px solid ${T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            Pas disponible
          </button>
        </div>
      )}
    </div>
  );
}

export function WorkerApp() {
  const { session, profile, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>('flux');
  const [flux, setFlux] = useState<MissionWithStructure[]>([]);
  const [apps, setApps] = useState<ApplicationWithMission[]>([]);
  const [attendance, setAttendance] = useState<Map<string, AttendanceEvent[]>>(new Map());
  const [receivedRatings, setReceivedRatings] = useState<Map<string, number>>(new Map());
  const [ratedStructureIds, setRatedStructureIds] = useState<Set<string>>(new Set());
  const [structRatings, setStructRatings] = useState<Map<string, StructureRating>>(new Map());
  const [unread, setUnread] = useState<Map<string, number>>(new Map());
  const [stats, setStats] = useState<WorkerStats | null>(null);
  const [spotOffers, setSpotOffers] = useState<SpotOffer[]>([]);
  const [offerBusy, setOfferBusy] = useState(false);
  const [showEarnings, setShowEarnings] = useState(false);
  const [rates, setRates] = useState<CommissionRates | null>(null);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MissionWithStructure | null>(null);
  const [structureProfile, setStructureProfile] = useState<MissionWithStructure | null>(null);
  const [structureReviews, setStructureReviews] = useState<StructureReview[]>([]);
  const [ratingFor, setRatingFor] = useState<ApplicationWithMission | null>(null);
  const [structureRatingScore, setStructureRatingScore] = useState<number | null>(null);
  const [structureRatingNote, setStructureRatingNote] = useState('');
  const [ratingRequests, setRatingRequests] = useState<RatingRequest[]>([]);
  const [autoRatingRequestId, setAutoRatingRequestId] = useState<string | null>(null);
  const [snoozedThisSession, setSnoozedThisSession] = useState<Set<string>>(new Set());
  const [qrFor, setQrFor] = useState<{ app: ApplicationWithMission; step: QRTokenType } | null>(null);
  const [chatFor, setChatFor] = useState<ApplicationWithMission | null>(null);
  const [alrt, setAlrt] = useState<{ app: ApplicationWithMission; type: 'retard' | 'annulation' } | null>(null);
  const [kycFor, setKycFor] = useState<ApplicationWithMission | null>(null);
  const [signal, setSignal] = useState<ApplicationWithMission | null>(null);
  const [sigMotif, setSigMotif] = useState<string | null>(null);
  const [sigNote, setSigNote] = useState('');
  const [docKey, setDocKey] = useState<DocKey | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const tr = useRef<ReturnType<typeof setTimeout>>();

  useBodyScrollLock(Boolean(detail || structureProfile || ratingFor || chatFor || alrt || kycFor || signal || docKey || qrFor));

  const ville = profile?.city || (session?.user.user_metadata?.city as string | undefined) || '';
  const prenom = (profile?.full_name || session?.user.email || '').split(' ')[0] || '';

  function notif(m: string) {
    setToast(m);
    clearTimeout(tr.current);
    tr.current = setTimeout(() => setToast(null), 3000);
  }

  async function load() {
    if (!session) return;
    try {
      const [missions, myApps, received, myStats, offers, pendingRatingRequests] = await Promise.all([
        fetchOpenMissions(),
        fetchMyApplications(session.user.id),
        fetchWorkerReceivedRatings(session.user.id),
        fetchWorkerStats().catch(() => null),
        fetchMySpotOffers().catch(() => [] as SpotOffer[]),
        fetchPendingRatingRequests(session.user.id).catch(() => [] as RatingRequest[]),
      ]);
      setFlux(missions);
      setApps(myApps);
      setReceivedRatings(received);
      setSpotOffers(offers);
      setRatingRequests(pendingRatingRequests);
      if (myStats) setStats(myStats);
      const structureIds = [...new Set(missions.map((m) => m.structure_id))];
      setStructRatings(await fetchStructureRatings(structureIds));
      const activeIds = myApps.filter((a) => ['accepted', 'in_progress', 'payment_pending', 'completed'].includes(a.status)).map((a) => a.id);
      const cvIds = myApps.filter((a) => a.cv_status != null || a.status === 'completed').map((a) => a.id);
      const [unreadMap, attendanceMap, ratedStructure] = await Promise.all([
        fetchUnreadCounts(activeIds, session.user.id),
        fetchAttendanceEvents(myApps.map((a) => a.id)).catch(() => new Map<string, AttendanceEvent[]>()),
        fetchRatedApplicationIds(cvIds, 'worker_to_structure').catch(() => new Set<string>()),
      ]);
      setUnread(unreadMap);
      setAttendance(attendanceMap);
      setRatedStructureIds(ratedStructure);
    } catch {
      notif('Impossible de charger les missions.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Flux en direct : toute mission publiée/clôturée rafraîchit la liste.
  // Les événements arrivent parfois en rafale (plusieurs structures actives) :
  // un court debounce évite de relancer toutes les requêtes à chaque événement.
  useEffect(() => {
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const channel = subscribeToMissionFeed(() => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        load();
      }, 800);
    });
    return () => {
      clearTimeout(reloadTimer);
      unsubscribeMissionFeed(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Mes candidatures en direct : la structure confirme le pointage (scan du
  // QR) depuis un autre appareil — la carte "mission en cours" doit
  // disparaître automatiquement, sans rechargement manuel de la page.
  useEffect(() => {
    if (!session) return;
    const channel = subscribeToMyApplicationsFeed(session.user.id, () => load());
    return () => unsubscribeApplicationsFeed(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Demande de note automatique : premiere connexion, puis rappels a 24h et
  // 72h (shouldPromptRatingRequest). "Me le rappeler plus tard" ne supprime
  // jamais la demande — elle reste accessible depuis l'historique.
  useEffect(() => {
    if (ratingFor || !session) return;
    const due = ratingRequests.find((r) => !snoozedThisSession.has(r.id) && shouldPromptRatingRequest(r));
    if (!due) return;
    const app = apps.find((a) => a.id === due.applicationId);
    if (!app) return;
    setAutoRatingRequestId(due.id);
    setRatingFor(app);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratingRequests, apps, ratingFor, session]);

  // Taux de commission (configurés dans Supabase) pour « Tu recevras ».
  useEffect(() => {
    fetchCommissionRates().then(setRates).catch(() => undefined);
  }, []);

  // Position du navigateur (jamais stockee en base) : affiche la distance et
  // trie le flux par proximite.
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }, []);

  function missionDistance(m: MissionWithStructure): number | null {
    if (!position || m.lat == null || m.lng == null) return null;
    return distanceKm(position, { lat: m.lat, lng: m.lng });
  }

  const appliedIds = new Set(apps.filter((a) => a.status !== 'cancelled').map((a) => a.mission_id));
  // Une fois la candidature envoyee, la mission disparait du flux.
  const visibleFlux = flux
    .filter((m) => !appliedIds.has(m.id))
    .slice()
    .sort((a, b) => {
      const da = missionDistance(a);
      const db = missionDistance(b);
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
  // La carte "mission en cours" quitte l'ecran des que la fin est confirmee :
  // payment_pending n'y figure plus (elle bascule aussitot dans le CV, avec
  // le statut de verification adequat).
  const acceptedApps = apps.filter((a) => a.status === 'accepted' || a.status === 'in_progress');
  const pendingApps = apps.filter((a) => a.status === 'pending');
  // CV vivant : toute mission dont la fin est confirmee (cv_status renseigne),
  // plus les anciennes lignes 'completed' d'avant ce correctif (cv_status
  // alors null, traitees comme deja verifiees).
  const cvApps = apps.filter((a) => a.cv_status != null || a.status === 'completed');
  const cvStatusOf = (a: ApplicationWithMission): CvStatus => a.cv_status ?? 'verified';
  const verifiedCvApps = cvApps.filter((a) => cvStatusOf(a) === 'verified');
  const missionCategories = completedMissionCategories(verifiedCvApps);
  const cvCount = verifiedCvApps.length;
  const receivedScores = verifiedCvApps.map((a) => receivedRatings.get(a.id)).filter((s): s is number => Boolean(s));
  const receivedAvg = receivedScores.length ? receivedScores.reduce((s, v) => s + v, 0) / receivedScores.length : null;
  const unreadTotal = [...unread.values()].reduce((s, v) => s + v, 0);
  const kycIsReady = isKycReady(profile);
  const kycNeeded = acceptedApps.length > 0 && !kycIsReady;

  async function postuler(m: MissionWithStructure) {
    if (!session || appliedIds.has(m.id) || busyId) return;
    setBusyId(m.id);
    try {
      await applyToMission(m.id, session.user.id);
      await load();
      setDetail(null);
      notif('✓ Candidature envoyée');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Impossible de postuler.');
    } finally {
      setBusyId(null);
    }
  }

  function closeRatingModal(snooze: boolean) {
    if (snooze && autoRatingRequestId) {
      setSnoozedThisSession((prev) => new Set(prev).add(autoRatingRequestId));
      snoozeRatingRequest(autoRatingRequestId).catch(() => undefined);
    }
    setRatingFor(null);
    setAutoRatingRequestId(null);
    setStructureRatingScore(null);
    setStructureRatingNote('');
  }

  async function noterStructure() {
    if (!session || !ratingFor?.mission || structureRatingScore == null) return;
    try {
      await rate({
        applicationId: ratingFor.id,
        structureId: ratingFor.mission.structure_id,
        workerId: session.user.id,
        score: structureRatingScore,
        direction: 'worker_to_structure',
        comment: structureRatingNote.slice(0, 280),
      });
      if (autoRatingRequestId) setSnoozedThisSession((prev) => new Set(prev).add(autoRatingRequestId));
      await load();
      notif('Avis enregistré. Il sera visible une fois que les deux parties auront répondu (ou après quelques jours).');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Notation impossible.');
    } finally {
      setRatingFor(null);
      setAutoRatingRequestId(null);
      setStructureRatingScore(null);
      setStructureRatingNote('');
    }
  }

  async function handleAlrt(minutes?: number) {
    if (!alrt) return;
    try {
      if (alrt.type === 'retard' && minutes) {
        await notifyDelay(alrt.app.id, minutes);
        notif(`Retard ${minutes} min signalé à la structure.`);
      } else if (alrt.type === 'annulation') {
        await updateApplicationStatus(alrt.app.id, 'cancelled');
        await load();
        notif('Mission annulée. La structure est prévenue, sans conséquence pour toi.');
      }
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Action impossible.');
    } finally {
      setAlrt(null);
    }
  }

  async function envoyerSignalement() {
    if (!session || !signal || !sigMotif) return;
    try {
      await reportMissionIssue({
        applicationId: signal.id,
        category: sigMotif,
        description: sigNote,
        severity: ['danger', 'violence', 'harcelement', 'discrimination', 'accident', 'menace'].includes(sigMotif) ? 'critical' : 'medium',
      });
      await load();
      notif('Signalement transmis à Support UROSI — aucun impact automatique sur ton accès.');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Envoi impossible.');
    } finally {
      setSignal(null);
      setSigMotif(null);
      setSigNote('');
    }
  }

  function ouvrirPointage(app: ApplicationWithMission, step: QRTokenType) {
    if (!isKycReady(profile)) {
      setKycFor(app);
      notif('Ajoute ton IBAN et ta pièce pour débloquer le pointage.');
      return;
    }
    setQrFor({ app, step });
  }

  function openStructureProfile(mission: MissionWithStructure) {
    setDetail(null);
    setStructureProfile(mission);
    setStructureReviews([]);
    fetchStructureReviews(mission.structure_id).then(setStructureReviews).catch(() => setStructureReviews([]));
  }

  // Le flux sert uniquement à décider rapidement. Toutes les informations
  // secondaires restent disponibles dans la fiche complète ouverte au clic.
  function fluxCard(m: MissionWithStructure) {
    const sr = structRatings.get(m.structure_id);
    const isBusy = busyId === m.id;
    return (
      <article
        key={m.id}
        style={{ position: 'relative', background: T.card, border: `1px solid ${m.is_solidaire ? '#14532d' : T.cb}`, borderRadius: 14, padding: 14 }}
      >
        <button type="button" aria-label={`Voir la fiche complète de ${m.title}`} onClick={() => setDetail(m)} style={{ position: 'absolute', inset: 0, zIndex: 0, width: '100%', border: 0, borderRadius: 14, background: 'transparent', cursor: 'pointer' }} />
        <div style={{ position: 'relative', zIndex: 1, pointerEvents: 'none' }}>
          <div style={{ fontSize: 31, fontWeight: 900, color: m.is_solidaire ? T.green : T.text, letterSpacing: -1.5, lineHeight: 1, marginBottom: 7 }}>
            {m.is_solidaire ? '0 €' : euros(missionPriceTotalCents(m))}
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text, marginBottom: 5 }}>{m.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <button
              type="button"
              onClick={() => setDetail(m)}
              style={{ pointerEvents: 'auto', minWidth: 0, padding: 0, border: 0, background: 'none', fontSize: 11, fontWeight: 800, color: T.sub, textDecoration: 'underline', textDecorationColor: T.cb, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {m.structure?.name ?? 'Structure'}
            </button>
            {sr && <span aria-label={`Note moyenne ${sr.average.toFixed(1)} sur 5`} style={{ flexShrink: 0, color: T.amber, fontSize: 10.5, fontWeight: 900 }}>⭐ {sr.average.toFixed(1).replace('.', ',')}</span>}
          </div>
          <div style={{ color: T.mu, fontSize: 10.5, marginTop: 5 }}>📍 {m.city || 'MEL'}</div>
          <div style={{ pointerEvents: 'auto', marginTop: 11 }}>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void postuler(m)}
              style={{ width: '100%', background: m.is_solidaire ? '#16a34a' : '#fff', color: m.is_solidaire ? '#fff' : '#000', border: 'none', borderRadius: 9, padding: '10px 0', fontSize: 13, fontWeight: 900, cursor: isBusy ? 'wait' : 'pointer', opacity: isBusy ? 0.65 : 1 }}
            >
              {isBusy ? 'Envoi…' : m.is_solidaire ? 'Participer' : 'Accepter'}
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT }}>
      <div style={{ width: '100%', maxWidth: 430, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* Header */}
        <div style={{ padding: '22px 16px 12px', borderBottom: `1px solid ${T.cb}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: T.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: '#fff', fontSize: 14 }}>U</div>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.cyan, background: '#22d3ee15', borderRadius: 20, padding: '3px 8px' }}>
              {cvCount} mission{cvCount > 1 ? 's' : ''} au CV
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: T.mu, fontWeight: 700 }}>{prenom}</span>
            <ThemeToggle />
            {session && <NotificationBell profileId={session.user.id} onDataChanged={() => load()} />}
          </div>
        </div>

        {toast && <div style={{ margin: '8px 12px 0', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '7px 11px', fontSize: 11, color: T.sub }}>{toast}</div>}

        {spotOffers.map((offer) => (
          <SpotOfferBanner
            key={offer.id}
            offer={offer}
            busy={offerBusy}
            onRespond={async (accept) => {
              if (offerBusy) return;
              setOfferBusy(true);
              try {
                const state = await respondToSpotOffer(offer.id, accept);
                if (state === 'accepted') notif('Participation confirmée ! La mission est dans « Missions ».');
                else if (state === 'declined') notif('C’est noté, merci pour ta réponse.');
                else if (state === 'expired') notif('Le délai de confirmation est dépassé.');
                else if (state === 'capacity_full' || state === 'application_not_pending') notif('Cette mission n’est plus disponible.');
                else notif('Cette proposition n’est plus disponible.');
              } catch (e) {
                notif(e instanceof Error ? e.message : 'Réponse impossible.');
              } finally {
                setOfferBusy(false);
                load();
              }
            }}
          />
        ))}

        <div style={{ padding: '10px 12px 84px', flex: 1 }}>
          {/* ── FLUX ── */}
          {tab === 'flux' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {position && visibleFlux.some((m) => m.lat != null) && (
                <div style={{ fontSize: 9.5, color: T.mu, textAlign: 'center' }}>📍 Flux trié par distance autour de toi</div>
              )}
              {loading && <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 20 }}>Chargement…</div>}
              {!loading && visibleFlux.length === 0 && (
                <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: '24px 16px', textAlign: 'center', fontSize: 11, color: T.sub, lineHeight: 1.6 }}>
                  Aucune mission disponible pour l'instant.
                  <br />
                  Les missions où tu as postulé n'apparaissent plus ici.
                </div>
              )}
              {visibleFlux.map(fluxCard)}
            </div>
          )}

          {/* ── MES MISSIONS + CV ── */}
          {tab === 'moi' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pendingApps.map((application) => (
                <div key={`pending-${application.id}`} style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{application.mission?.title ?? 'Mission'}</div>
                    <span role="status" aria-label="En attente de confirmation de la structure" style={{ flexShrink: 0, color: T.amber, fontSize: 10.5, fontWeight: 900 }}>
                      <span aria-hidden="true">⏳ </span>En attente
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: T.mu }}>
                    {application.mission?.city ? `📍 ${application.mission.city} · ` : ''}
                    {application.mission?.scheduled_date ?? ''}
                  </div>
                </div>
              ))}
              {acceptedApps.length === 0 && pendingApps.length === 0 && (
                <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: '24px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: T.sub, marginBottom: 12 }}>Aucune mission en cours</div>
                  <button onClick={() => setTab('flux')} style={{ background: '#fff', color: '#000', border: 'none', borderRadius: 9, padding: '9px 22px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                    Voir le flux →
                  </button>
                </div>
              )}
              {acceptedApps.map((a) => {
                const unreadCount = unread.get(a.id) ?? 0;
                const events = attendance.get(a.id) ?? [];
                const startDone = Boolean(a.actual_start_at || a.checked_in_at);
                return (
                  <div key={a.id} style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: T.text, marginBottom: 2 }}>{a.mission?.title ?? 'Mission'}</div>
                    <div style={{ fontSize: 10, color: T.mu, marginBottom: 11 }}>
                      {a.mission?.city ? `📍 ${a.mission.city} · ` : ''}
                      {a.mission?.scheduled_date ?? ''}
                    </div>
                    {!kycIsReady && (
                      <div style={{ background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 12, padding: '11px 12px', marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: T.amber, marginBottom: 3 }}>Infos paiement demandées après acceptation</div>
                        <div style={{ fontSize: 9.5, color: T.sub, lineHeight: 1.45, marginBottom: 9 }}>
                          Ajoute ton IBAN et ta pièce d'identité pour débloquer le pointage QR de cette mission.
                        </div>
                        <button onClick={() => setKycFor(a)} style={{ width: '100%', background: '#fff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>
                          Compléter maintenant
                        </button>
                      </div>
                    )}
                    <div style={{ background: T.row, border: `1px solid ${startDone ? T.greenBorder : T.cb}`, borderRadius: 12, padding: '11px 12px', marginBottom: 10 }}>
                      {startDone && (
                        <div style={{ fontSize: 11, fontWeight: 900, color: T.green, marginBottom: 8 }}>
                          🟢 Mission en cours · débutée à {new Date(a.actual_start_at || a.checked_in_at || '').toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                      <div style={{ fontSize: 9.5, color: T.mu, marginBottom: 8 }}>
                        {startDone ? 'La structure scanne ce QR pour confirmer la fin — aucune action de plus après.' : 'Présente ce QR à la structure, elle le scanne pour confirmer ton arrivée.'}
                      </div>
                      <button
                        onClick={() => ouvrirPointage(a, startDone ? 'end' : 'start')}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, background: startDone ? T.grad : '#fff', color: startDone ? '#fff' : '#000', border: 'none', borderRadius: 11, padding: '15px 0', fontSize: 14, fontWeight: 900, cursor: 'pointer' }}
                      >
                        <span aria-hidden="true" style={{ fontSize: 18 }}>▦</span>
                        {!kycIsReady ? 'Ajouter IBAN + pièce' : startDone ? 'Afficher mon QR de départ' : 'Afficher mon QR d’arrivée'}
                      </button>
                      {a.delay_minutes > 0 && (
                        <div style={{ marginTop: 8, fontSize: 9.5, color: a.delay_minutes <= 5 ? T.amber : T.red }}>
                          Retard calculé : {a.delay_minutes} min · {a.delay_status === 'tolerated' ? 'toléré' : a.delay_status}
                        </div>
                      )}
                    </div>
                    {events.length > 0 && (
                      <div style={{ background: '#02061755', border: `1px solid ${T.cb}`, borderRadius: 10, padding: '9px 10px', marginBottom: 10 }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Historique pointage</div>
                        {events.slice(-4).map((ev) => (
                          <div key={ev.id} style={{ display: 'flex', gap: 7, alignItems: 'baseline', fontSize: 10, color: T.sub, padding: '3px 0' }}>
                            <span style={{ color: T.mu, minWidth: 42 }}>{new Date(ev.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                            <span>{attendanceEventLabel(ev)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {a.conversation_status === 'open' && (
                      <button
                        onClick={() => setChatFor(a)}
                        style={{ position: 'relative', width: '100%', background: '#1d4ed815', color: '#93c5fd', border: '1px solid #1e40af', borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer', marginBottom: 7 }}
                      >
                        💬 Discuter avec la structure
                        {unreadCount > 0 && (
                          <span style={{ position: 'absolute', top: -6, right: -4, minWidth: 15, height: 15, borderRadius: 8, background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                            {unreadCount}
                          </span>
                        )}
                      </button>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 7 }}>
                      <button onClick={() => setAlrt({ app: a, type: 'retard' })} style={{ background: T.amberBg, color: T.amber, border: `1px solid ${T.amberBorder}`, borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        ⏱ Retard
                      </button>
                      <button onClick={() => setAlrt({ app: a, type: 'annulation' })} style={{ background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        ✕ Annuler
                      </button>
                    </div>
                    <button
                      onClick={() => ouvrirPointage(a, startDone ? 'end' : 'start')}
                      style={{ width: '100%', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer', marginBottom: 6 }}
                    >
                      {kycIsReady ? (startDone ? 'Terminer la mission' : 'Démarrer la mission') : 'Ajouter IBAN + pièce pour pointer'}
                    </button>
                    <button onClick={() => setSignal(a)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#f59e0b', textDecoration: 'underline' }}>
                      ⚠ Signaler un problème
                    </button>
                  </div>
                );
              })}

              {/* CV VIVANT */}
              <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
                <div style={{ display: 'flex', gap: 11, alignItems: 'center', marginBottom: 13 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg,#f97316,#dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: '#fff', fontSize: 17 }}>
                    {(prenom || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: T.text }}>{profile?.full_name || session?.user.email}</div>
                    <div style={{ fontSize: 10, color: T.mu }}>{ville ? `${ville} · ` : ''}CV vivant</div>
                  </div>
                </div>
                {profile?.kyc_status === 'verified' && (
                  <div style={{ color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 10, padding: '9px 11px', fontSize: 10.5, fontWeight: 900, marginBottom: 12 }}>
                    ✓ Compte, identité et informations de paiement vérifiés
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <button type="button" onClick={() => setShowEarnings((visible) => !visible)} aria-label={showEarnings ? 'Masquer mes gains' : 'Afficher mes gains'} style={{ background: T.row, color: T.cyan, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '5px 8px', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}>
                    {showEarnings ? 'Masquer mes gains' : 'Afficher mes gains'}
                  </button>
                </div>
                {/* Réputation étoiles d'abord (comme côté structure) : étoiles,
                    puis la note, puis le nombre d'avis toujours visible. */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, marginBottom: 13 }}>
                  <span aria-hidden="true" style={{ fontSize: 22, letterSpacing: 2, color: '#f59e0b', lineHeight: 1 }}>
                    {[1, 2, 3, 4, 5].map((n) => (n <= Math.round(receivedAvg ?? 0) ? '★' : '☆')).join('')}
                  </span>
                  <div style={{ fontSize: 26, fontWeight: 900, color: T.text, lineHeight: 1.1 }}>{receivedAvg ? receivedAvg.toFixed(1).replace('.', ',') : '—'}</div>
                  <div style={{ fontSize: 10.5, color: T.mu }}>{receivedScores.length} avis</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 13 }}>
                  {[
                    ['Missions prouvées', String(cvCount)],
                    ['Gains totaux', stats ? (showEarnings ? euros(stats.earnings_total_cents) : '•••') : '—'],
                  ].map(([l, v]) => (
                    <div key={l} style={{ background: T.row, borderRadius: 9, padding: '11px 6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: T.text }}>{v}</div>
                      <div style={{ fontSize: 8.5, color: T.mu, marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>
                {missionCategories.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Expérience par secteur</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {missionCategories.map(([category, count]) => (
                        <span key={category} style={{ fontSize: 9.5, fontWeight: 800, color: T.cyan, background: '#22d3ee12', border: '1px solid #164e63', borderRadius: 12, padding: '3px 9px' }}>
                          {category} · {count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {profile?.skills && profile.skills.length > 0 && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
                    {profile.skills.map((s) => (
                      <span key={s} style={{ fontSize: 9.5, fontWeight: 700, color: T.cyan, background: '#22d3ee12', border: '1px solid #164e63', borderRadius: 12, padding: '2px 9px' }}>
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Historique vérifié</div>
                {cvApps.length === 0 && <div style={{ fontSize: 11, color: T.mu }}>Tes missions terminées apparaîtront ici, avec la note donnée par la structure.</div>}
                <style>{`@keyframes urosiCvDot{0%,100%{opacity:.25}50%{opacity:1}} .urosi-cv-dots span{animation:urosiCvDot 1.3s ease-in-out infinite} .urosi-cv-dots span:nth-child(2){animation-delay:.18s} .urosi-cv-dots span:nth-child(3){animation-delay:.36s}`}</style>
                {cvApps.map((a, i) => {
                  const score = receivedRatings.get(a.id);
                  const status = cvStatusOf(a);
                  return (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: i > 0 ? `1px solid ${T.cb}` : 'none' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.mission?.title ?? 'Mission'}</div>
                        <div style={{ fontSize: 9, color: T.mu }}>
                          {a.mission?.scheduled_date ?? ''}
                          {a.checked_in_at ? ' · présence validée' : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {status === 'verified' && (score ? <Stars n={score} size={10} /> : <span style={{ fontSize: 9, color: T.mu }}>pas encore notée</span>)}
                        {status === 'verified' && !ratedStructureIds.has(a.id) && (
                          <button
                            onClick={() => setRatingFor(a)}
                            style={{ fontSize: 9, fontWeight: 800, color: T.cyan, background: '#22d3ee15', border: 'none', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}
                          >
                            Noter la structure
                          </button>
                        )}
                        {status === 'pending_verification' && (
                          <span aria-label="Vérification en cours" title="Mission terminée, vérification en cours" className="urosi-cv-dots" style={{ fontSize: 13, fontWeight: 900, color: T.mu, letterSpacing: 2 }}>
                            <span>•</span><span>•</span><span>•</span>
                          </span>
                        )}
                        {status === 'verified' && <span style={{ fontSize: 9, fontWeight: 800, color: T.green }}>✓</span>}
                        {status === 'disputed' && (
                          <button
                            onClick={() => notif(a.cv_status_reason ? `Contestée : ${a.cv_status_reason}` : 'Mission contestée par la structure.')}
                            style={{ fontSize: 9, fontWeight: 800, color: T.amber, background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}
                          >
                            ⚠ Contestée
                          </button>
                        )}
                        {status === 'rejected' && (
                          <button
                            onClick={() => notif(a.cv_status_reason ? `Rejetée : ${a.cv_status_reason}` : 'Mission rejetée par le support UROSI.')}
                            style={{ fontSize: 9, fontWeight: 800, color: T.red, background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}
                          >
                            ✕ Rejetée
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── PROFIL : wallet, stats, infos ── */}
          {tab === 'profil' && session && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <WalletCard profileId={session.user.id} mode="worker" amountsVisible={showEarnings} onAmountsVisibleChange={setShowEarnings} />
              {stats && stats.monthly.length > 0 && (
                <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Mes gains par mois</div>
                  {stats.monthly.map((m) => (
                    <div key={m.month} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '4px 0' }}>
                      <span style={{ color: T.sub }}>
                        {m.month} · {m.missions} mission{m.missions > 1 ? 's' : ''}
                      </span>
                      <span style={{ color: T.green, fontWeight: 800 }}>{showEarnings ? euros(m.earnings_cents) : '•••'}</span>
                    </div>
                  ))}
                  {stats.bonus_total_cents > 0 && (
                    <div style={{ fontSize: 10, color: '#facc15', marginTop: 6 }}>⚡ dont {showEarnings ? euros(stats.bonus_total_cents) : '•••'} de bonus (rémunérations boostées)</div>
                  )}
                </div>
              )}
              <ProfilCard
                fullName={profile?.full_name || ''}
                ville={ville}
                phone={profile?.phone || ''}
                isMicro={profile?.is_micro_entrepreneur ?? false}
                bio={profile?.bio || ''}
                skills={profile?.skills ?? []}
                onSave={async (updates) => {
                  if (!session) return;
                  await updateProfile(session.user.id, updates);
                  await refreshProfile();
                  notif('Profil mis à jour ✓');
                }}
              />
              {/* Compte : email + statut de vérification (le SMS arrive plus tard) */}
              <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Compte</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ color: T.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.user.email}</span>
                  {session.user.email_confirmed_at ? (
                    <span style={{ fontSize: 9, fontWeight: 800, color: T.green, background: T.greenBg, borderRadius: 10, padding: '2px 8px', flexShrink: 0 }}>✓ Email vérifié</span>
                  ) : (
                    <span style={{ fontSize: 9, fontWeight: 800, color: T.amber, background: T.amberBg, borderRadius: 10, padding: '2px 8px', flexShrink: 0 }}>Email à confirmer</span>
                  )}
                </div>
                {profile?.phone && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 7 }}>
                    <span style={{ color: T.sub }}>{profile.phone}</span>
                    <span style={{ fontSize: 9, fontWeight: 800, color: T.mu, background: T.row, borderRadius: 10, padding: '2px 8px', flexShrink: 0 }}>Vérification SMS bientôt</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 7 }}>
                  <span style={{ color: T.sub }}>Paiement + identité</span>
                  <span style={{ fontSize: 9, fontWeight: 800, color: kycBadge(profile).color, background: kycBadge(profile).bg, borderRadius: 10, padding: '2px 8px', flexShrink: 0 }}>{kycBadge(profile).label}</span>
                </div>
                {kycNeeded && (
                  <button onClick={() => setKycFor(acceptedApps[0] ?? null)} style={{ width: '100%', marginTop: 9, background: T.row, color: T.text, border: `1px solid ${T.cb}`, borderRadius: 9, padding: '9px 0', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                    Compléter après acceptation
                  </button>
                )}
              </div>
              <AideRegles onOpen={setDocKey} />
              <a href="/demo?role=worker" style={{ display: 'block', padding: '8px 4px', fontSize: 11, color: T.cyan, fontWeight: 700, textDecoration: 'none' }}>
                ▶ Voir la démo
              </a>
              <button onClick={() => signOut()} style={{ textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 4px', fontSize: 11, color: T.sub, fontWeight: 600 }}>
                Se déconnecter
              </button>
            </div>
          )}
        </div>

        {/* Bottom nav */}
        <nav aria-label="Navigation principale" style={{ width: '100%', maxWidth: 430, borderTop: `1px solid ${T.cb}`, padding: '7px 10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, position: 'fixed', zIndex: 40, bottom: 0, left: '50%', transform: 'translateX(-50%)', background: T.bg, boxShadow: '0 -10px 28px rgba(0,0,0,.16)' }}>
          {(
            [
              ['flux', '⌁', 'Flux'],
              ['moi', '🌳', 'Missions'],
              ['profil', '🏦', 'Wallet'],
            ] as [Tab, string, string][]
          ).map(([k, ic, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 0', borderRadius: 8, border: 'none', cursor: 'pointer', background: tab === k ? '#fff' : 'transparent', color: tab === k ? '#000' : T.mu, position: 'relative' }}>
              <span style={{ fontSize: 14 }}>{ic}</span>
              <span style={{ fontSize: 10, fontWeight: 700 }}>{l}</span>
              {k === 'moi' && unreadTotal > 0 && (
                <span style={{ position: 'absolute', top: 4, right: 14, minWidth: 14, height: 14, borderRadius: 8, background: '#dc2626', color: '#fff', fontSize: 8.5, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                  {unreadTotal > 9 ? '9+' : unreadTotal}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Détail mission */}
        {detail && (
          <div className="urosi-modal-layer urosi-bottom-sheet-layer" style={SHEET} onClick={() => setDetail(null)}>
            <div className="urosi-bottom-sheet" role="dialog" aria-modal="true" aria-label={`Fiche complète de ${detail.title}`} style={SHEET_BODY} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <button onClick={() => setDetail(null)} style={{ background: T.row, border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', color: T.sub, fontSize: 13 }}>×</button>
              </div>
              {detail.is_solidaire ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 24, fontWeight: 900, color: T.green, letterSpacing: -1 }}>Mission solidaire</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: T.sub }}>0 €</span>
                </div>
              ) : (
                <div style={{ fontSize: 30, fontWeight: 900, color: T.text, letterSpacing: -2, marginBottom: 4 }}>{euros(missionPriceTotalCents(detail))}</div>
              )}
              <div style={{ fontSize: 16, fontWeight: 900, color: T.text, marginBottom: 10 }}>{detail.title}</div>
              <section aria-label="Détails de la structure" style={{ borderTop: `1px solid ${T.cb}`, borderBottom: `1px solid ${T.cb}`, padding: '11px 0', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text }}>{detail.structure?.name ?? 'Structure'}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 900, color: T.amber, marginTop: 3 }}>
                    {(() => {
                      const sr = structRatings.get(detail.structure_id);
                      return sr ? `⭐ ${sr.average.toFixed(1).replace('.', ',')} · ${sr.count} avis` : 'Nouvelle structure';
                    })()}
                    <span style={{ color: detail.structure?.verification_status === 'verified' || detail.structure?.verification_status === 'founder_bypass' ? T.green : T.amber }}> · {detail.structure?.verification_status === 'verified' || detail.structure?.verification_status === 'founder_bypass' ? '✓ Vérifiée' : 'Vérification en cours'}</span>
                  </div>
                </div>
                <button type="button" onClick={() => openStructureProfile(detail)} style={{ border: 0, padding: '6px 0', background: 'transparent', color: T.sub, fontSize: 10.5, fontWeight: 900, cursor: 'pointer' }}>Voir le profil</button>
              </section>
              <section aria-label="Date, horaires et durée" style={{ marginBottom: 4 }}>
                {detail.slots && detail.slots.length > 0 ? (
                  groupByDay(detail.slots).map((day) => (
                    <div key={day.date} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: T.sub, padding: '2px 0' }}>
                      <span style={{ fontWeight: 700, color: T.text }}>{formatDay(day.date)}</span>
                      <span>{day.ranges.join(' · ')}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 11.5, color: T.sub }}>
                    {formatDay(detail.scheduled_date)}
                    {detail.start_time ? ` · ${detail.start_time.slice(0, 5)}` : ''}
                    {detail.end_time ? `–${detail.end_time.slice(0, 5)}` : ''}
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: T.sub, marginTop: 4 }}>⌛ {formatHours(detail.duration_minutes)}</div>
              </section>
              <section aria-label="Adresse complète" style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.55, marginBottom: 14 }}>
                📍 {detail.address || detail.location || detail.city || 'Adresse à confirmer'}
                {(() => {
                  const distance = missionDistance(detail);
                  return distance != null ? ` · ${formatDistance(distance)}` : '';
                })()}
              </section>
              <button
                onClick={() => postuler(detail)}
                style={{ width: '100%', background: detail.is_solidaire ? T.green : '#fff', color: detail.is_solidaire ? '#06100a' : '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 900, cursor: 'pointer', marginBottom: 12 }}
              >
                {detail.is_solidaire ? 'Participer' : 'Accepter'}
              </button>
              <details style={{ borderTop: `1px solid ${T.cb}`, paddingTop: 12 }}>
                <summary style={{ color: T.text, fontSize: 12, fontWeight: 900, cursor: 'pointer', padding: '3px 0 10px' }}>Voir les détails</summary>
                <div style={{ display: 'grid', gap: 13, color: T.sub, fontSize: 11, lineHeight: 1.65 }}>
                  <section aria-label="Description de la mission"><strong style={{ color: T.text }}>Description</strong><br />{detail.detail || 'Les consignes détaillées seront communiquées par la structure.'}</section>
                  <section aria-label="Conditions de la mission"><strong style={{ color: T.text }}>Conditions</strong><br />Type : {detail.mission_category || 'autre'}<br />Tenue : {detail.dress_code || 'Aucune tenue particulière indiquée'}<br />Équipement : {detail.equipment || 'Aucun équipement particulier indiqué'}</section>
                  <section aria-label="Consignes de la mission"><strong style={{ color: T.text }}>Consignes</strong><br />{detail.instructions || 'Les consignes complémentaires seront communiquées par la structure.'}</section>
                  <section aria-label="Informations pratiques"><strong style={{ color: T.text }}>Informations pratiques</strong><br />{SECTOR_LABELS[detail.sector ?? 'autre'] ?? detail.sector ?? 'Autre'} · difficulté {detail.difficulty || 1}<br />{detail.places > 1 ? `${detail.places} places disponibles` : '1 place disponible'}{detail.is_urgent ? ' · Mission urgente' : ''}</section>
                  {!detail.is_solidaire && rates && <section aria-label="Détail du montant"><strong style={{ color: T.text }}>Montant reçu</strong><br />Tu recevras {euros(splitPrice(detail.worker_rate_cents, rates.structurePct).netWorkerCents)}<PriceSplit values={splitPrice(detail.worker_rate_cents, rates.structurePct)} side="worker" />{detail.pricing_breakdown && detail.pricing_breakdown.adjustments.length > 0 && <PricingDetails breakdown={detail.pricing_breakdown} compact />}</section>}
                </div>
              </details>
            </div>
          </div>
        )}

        {/* Profil structure : uniquement les signaux utiles pour juger sa fiabilité. */}
        {structureProfile && (
          <div className="urosi-modal-layer urosi-bottom-sheet-layer" style={SHEET} onClick={() => setStructureProfile(null)}>
            <div className="urosi-bottom-sheet" role="dialog" aria-modal="true" aria-label={`Profil de ${structureProfile.structure?.name ?? 'la structure'}`} style={SHEET_BODY} onClick={(event) => event.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ color: T.text, fontSize: 18, fontWeight: 900 }}>{structureProfile.structure?.name ?? 'Structure'}</div>
                  <div style={{ color: structureProfile.structure?.verification_status === 'verified' || structureProfile.structure?.verification_status === 'founder_bypass' ? T.green : T.amber, fontSize: 10.5, fontWeight: 900, marginTop: 5 }}>{structureProfile.structure?.verification_status === 'verified' || structureProfile.structure?.verification_status === 'founder_bypass' ? '✓ Structure vérifiée' : 'Vérification en cours'}</div>
                </div>
                <button aria-label="Fermer le profil structure" onClick={() => setStructureProfile(null)} style={{ background: T.row, border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', color: T.sub }}>×</button>
              </div>
              <div style={{ color: T.amber, fontSize: 12, fontWeight: 900, marginTop: 12 }}>{(() => { const rating = structRatings.get(structureProfile.structure_id); return rating ? `⭐ ${rating.average.toFixed(1).replace('.', ',')} · ${rating.count} avis` : 'Pas encore notée'; })()}</div>
              <div style={{ color: T.sub, fontSize: 11.5, marginTop: 9 }}>📍 {structureProfile.city || structureProfile.address || 'Localisation à confirmer'}</div>
              <section aria-label="Avis sur la structure" style={{ marginTop: 18 }}>
                <div style={{ color: T.text, fontSize: 13, fontWeight: 900, marginBottom: 5 }}>Avis récents</div>
                {structureReviews.length === 0 ? <div style={{ color: T.mu, fontSize: 11, padding: '10px 0', borderTop: `1px solid ${T.cb}` }}>Aucun avis détaillé publié pour le moment.</div> : structureReviews.map((review) => <article key={`${review.created_at}-${review.comment}`} style={{ borderTop: `1px solid ${T.cb}`, padding: '11px 0' }}><div style={{ color: T.amber, fontSize: 10 }}>⭐ {review.score}/5</div><div style={{ color: T.sub, fontSize: 11, lineHeight: 1.55, marginTop: 4 }}>{review.comment}</div></article>)}
              </section>
              {structureProfile.structure?.about && <details style={{ borderTop: `1px solid ${T.cb}`, marginTop: 8, paddingTop: 12 }}><summary style={{ color: T.text, fontSize: 11.5, fontWeight: 900, cursor: 'pointer' }}>À propos</summary><p style={{ color: T.sub, fontSize: 11, lineHeight: 1.55 }}>{structureProfile.structure.about}</p></details>}
              <button type="button" onClick={() => { setStructureProfile(null); setTab('flux'); }} style={{ width: '100%', background: '#fff', color: '#000', border: 0, borderRadius: 10, padding: '12px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer', marginTop: 16 }}>Voir les missions disponibles</button>
            </div>
          </div>
        )}

        {/* Retard / Annulation */}
        {alrt && (
          <div className="urosi-modal-layer urosi-bottom-sheet-layer" role="dialog" aria-modal="true" aria-label={alrt.type === 'retard' ? 'Signaler un retard' : 'Annuler la mission'} style={SHEET} onClick={() => setAlrt(null)}>
            <div className="urosi-bottom-sheet" style={SHEET_BODY} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 14, fontWeight: 800, color: alrt.type === 'retard' ? T.amber : T.red, marginBottom: 5 }}>
                {alrt.type === 'retard' ? '⏱ Signaler un retard' : '✕ Annuler la mission'}
              </div>
              <div style={{ fontSize: 11, color: T.sub, marginBottom: 13, lineHeight: 1.5 }}>
                {alrt.type === 'retard'
                  ? 'La structure sera prévenue.'
                  : "La structure sera prévenue, à titre informatif. Aucun blocage de ton accès aux missions."}
              </div>
              {alrt.type === 'retard' ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  {[5, 10, 20, 30].map((min) => (
                    <button key={min} onClick={() => handleAlrt(min)} style={{ flex: 1, background: T.row, color: T.text, border: `1px solid ${T.cb}`, borderRadius: 7, padding: '9px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      {min} min{min === 30 ? '+' : ''}
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 7 }}>
                  <button onClick={() => setAlrt(null)} style={{ flex: 1, background: T.row, color: T.sub, border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    Revenir
                  </button>
                  <button onClick={() => handleAlrt()} style={{ flex: 1, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                    Confirmer l'annulation
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Signalement */}
        {signal && (
          <div className="urosi-modal-layer urosi-bottom-sheet-layer" role="dialog" aria-modal="true" aria-label="Signaler un problème" style={SHEET} onClick={() => { setSignal(null); setSigMotif(null); setSigNote(''); }}>
            <div className="urosi-bottom-sheet" style={SHEET_BODY} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#f59e0b', marginBottom: 3 }}>⚠ Signaler un problème</div>
              <div style={{ fontSize: 11, color: T.sub, marginBottom: 4 }}>{signal.mission?.title}</div>
              <div style={{ fontSize: 10, color: T.mu, marginBottom: 13, lineHeight: 1.55 }}>
                UROSI transmet ton signalement et joue l'intermédiaire. Aucun impact sur ton accès aux missions — signaler ne te pénalise jamais.
              </div>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Motif</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {Object.entries(WORKER_REPORT_MOTIFS).map(([k, l]) => (
                  <button key={k} onClick={() => setSigMotif(k)} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, background: sigMotif === k ? T.amberBg : T.row, color: sigMotif === k ? '#f59e0b' : T.text, border: `1.5px solid ${sigMotif === k ? '#f59e0b' : T.cb}`, borderRadius: 8, padding: '11px 13px', fontSize: 12, fontWeight: sigMotif === k ? 800 : 600, cursor: 'pointer' }}>
                    <span style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${sigMotif === k ? '#f59e0b' : T.cb}`, background: sigMotif === k ? '#f59e0b' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#000', fontWeight: 900 }}>
                      {sigMotif === k ? '✓' : ''}
                    </span>
                    {l}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>En deux mots, que s'est-il passé ?</div>
              <textarea
                value={sigNote}
                onChange={(e) => setSigNote(e.target.value)}
                rows={3}
                placeholder="Ex : la structure n'était pas sur place à l'heure convenue…"
                style={{ width: '100%', background: T.row, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '10px 12px', fontSize: 12, color: T.text, outline: 'none', boxSizing: 'border-box', resize: 'none', lineHeight: 1.5, marginBottom: 12 }}
              />
              <button onClick={envoyerSignalement} disabled={!sigMotif} style={{ width: '100%', background: sigMotif ? '#f59e0b' : T.row, color: sigMotif ? '#000' : T.mu, border: 'none', borderRadius: 9, padding: '12px 0', fontSize: 13, fontWeight: 900, cursor: sigMotif ? 'pointer' : 'not-allowed' }}>
                {sigMotif ? 'Envoyer le signalement' : 'Choisis un motif'}
              </button>
            </div>
          </div>
        )}

        {/* Recap + étoiles (travailleur note la structure) */}
        {ratingFor && (
          <div className="urosi-modal-layer urosi-bottom-sheet-layer" role="dialog" aria-modal="true" aria-label="Mission terminée" style={{ ...SHEET, background: 'rgba(0,0,0,.92)' }}>
            <div className="urosi-bottom-sheet" style={SHEET_BODY} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: T.greenBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>✓</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: T.green }}>Mission terminée</div>
                  <div style={{ fontSize: 10, color: T.mu }}>{ratingFor.mission?.title}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: T.sub, marginBottom: 12 }}>
                Comment s'est passée votre expérience avec la structure ?
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} aria-label={`${n} étoile${n > 1 ? 's' : ''}`} onClick={() => setStructureRatingScore(n)} style={{ flex: 1, padding: '12px 0', fontSize: 22, background: structureRatingScore === n ? T.amberBg : T.row, border: `1px solid ${structureRatingScore === n ? T.amberBorder : T.cb}`, borderRadius: 10, cursor: 'pointer', color: '#f59e0b' }}>
                    ★
                  </button>
                ))}
              </div>
              <textarea
                aria-label="Commentaire (facultatif)"
                value={structureRatingNote}
                onChange={(event) => setStructureRatingNote(event.target.value.slice(0, 280))}
                rows={3}
                placeholder="Ajoute une courte note facultative…"
                style={{ ...inp, resize: 'none', lineHeight: 1.5, marginBottom: 5 }}
              />
              <div style={{ color: T.mu, fontSize: 9, marginBottom: 10 }}>
                {structureRatingNote.length}/280 · Visible une fois que les deux parties auront répondu (ou après quelques jours).
              </div>
              <button onClick={noterStructure} disabled={structureRatingScore == null} style={{ width: '100%', background: structureRatingScore == null ? T.row : '#fff', color: structureRatingScore == null ? T.mu : '#000', border: 'none', borderRadius: 9, padding: '11px 0', fontSize: 12, fontWeight: 900, cursor: structureRatingScore == null ? 'not-allowed' : 'pointer', marginBottom: 6 }}>
                Envoyer mon avis
              </button>
              <button onClick={() => closeRatingModal(true)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.mu, padding: '4px 0' }}>
                Me le rappeler plus tard
              </button>
            </div>
          </div>
        )}

        {qrFor && (
          <WorkerQrPointageSheet
            applicationId={qrFor.app.id}
            step={qrFor.step}
            missionTitle={qrFor.app.mission?.title}
            onClose={() => setQrFor(null)}
            onConfirmed={() => {
              setQrFor(null);
              notif(qrFor.step === 'start' ? 'Début de mission confirmé.' : 'Fin de mission confirmée.');
              load();
            }}
          />
        )}

        {/* Chat avec la structure */}
        {chatFor && session && (
          <ChatSheet
            applicationId={chatFor.id}
            myId={session.user.id}
            title={chatFor.mission?.title ?? 'Mission'}
            onClose={() => {
              setChatFor(null);
              load();
            }}
          />
        )}

        {kycFor && session && (
          <KycSheet
            missionTitle={kycFor.mission?.title ?? 'Mission acceptée'}
            onClose={() => setKycFor(null)}
            onSave={async (updates, file) => {
              if (!file) throw new Error("Ajoute une pièce d'identité.");
              const uploaded = await uploadIdentityDocument(session.user.id, file);
              await submitWorkerKyc({
                ibanCountry: updates.ibanCountry,
                ibanLast4: updates.ibanLast4,
                documentName: uploaded.name,
                documentPath: uploaded.path,
              });
              await refreshProfile();
              notif('Infos envoyées ✓ Tu peux maintenant pointer la mission.');
            }}
          />
        )}

        {docKey && <DocModal dk={docKey} onClose={() => setDocKey(null)} />}
      </div>
    </div>
  );
}

function KycSheet({
  missionTitle,
  onClose,
  onSave,
}: {
  missionTitle: string;
  onClose: () => void;
  onSave: (updates: { ibanCountry: string; ibanLast4: string }, file: File | null) => Promise<void>;
}) {
  const [iban, setIban] = useState('');
  const [docName, setDocName] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ibanClean = normalizeIban(iban);
  const ibanOk = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(ibanClean);
  const ok = ibanOk && docFile !== null;

  async function submit() {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    let saved = false;
    try {
      await onSave({
        ibanCountry: ibanClean.slice(0, 2),
        ibanLast4: ibanClean.slice(-4),
      }, docFile);
      saved = true;
      onClose();
    } catch (e) {
      // Toujours logger l'erreur brute (Storage/Postgrest) en console pour le
      // diagnostic, en plus du message affiché à l'utilisateur.
      console.error('Soumission KYC échouée', e);
      const message =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string'
            ? (e as { message: string }).message
            : 'Envoi impossible.';
      setError(message);
    } finally {
      if (!saved) setBusy(false);
    }
  }

  return (
    <div className="urosi-modal-layer urosi-bottom-sheet-layer" role="dialog" aria-modal="true" aria-label="Débloquer le pointage" style={SHEET} onClick={onClose}>
      <div className="urosi-bottom-sheet" style={SHEET_BODY} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 13 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 900, color: T.text, marginBottom: 3 }}>Débloquer le pointage</div>
            <div style={{ fontSize: 10.5, color: T.sub, lineHeight: 1.5 }}>Mission acceptée : {missionTitle}</div>
          </div>
          <button onClick={onClose} style={{ background: T.row, border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', color: T.sub, fontSize: 13 }}>×</button>
        </div>
        <div style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 11, padding: '11px 12px', marginBottom: 12, fontSize: 10.5, color: T.sub, lineHeight: 1.5 }}>
          UROSI demande ces infos seulement après acceptation, pour préparer le paiement et la vérification d'identité. Le CV vivant reste inchangé.
        </div>
        <Fld label="IBAN">
          <input
            aria-label="IBAN"
            value={iban}
            onChange={(e) => setIban(e.target.value)}
            placeholder="FR76 3000 6000 0112 3456 7890 189"
            autoComplete="off"
            inputMode="text"
            style={inp}
          />
          {iban && !ibanOk && <div style={{ fontSize: 9.5, color: T.amber, marginTop: -7, marginBottom: 10 }}>Vérifie le format de l'IBAN.</div>}
        </Fld>
        <Fld label="Pièce d'identité">
          <input
            aria-label="Pièce d'identité"
            type="file"
            accept="image/*,.pdf"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setDocFile(file);
              setDocName(file?.name ?? '');
            }}
            style={{ ...inp, padding: '10px 12px' }}
          />
          {docName && <div style={{ fontSize: 9.5, color: T.green, marginTop: -7, marginBottom: 10 }}>Pièce ajoutée : {docName}</div>}
        </Fld>
        {error && <div style={{ fontSize: 11, color: T.red, marginBottom: 10 }}>{error}</div>}
        <button
          onClick={submit}
          disabled={!ok || busy}
          style={{ width: '100%', background: ok && !busy ? '#fff' : T.row, color: ok && !busy ? '#000' : T.mu, border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 13, fontWeight: 900, cursor: ok && !busy ? 'pointer' : 'not-allowed' }}
        >
          {busy ? '…' : ok ? 'Valider et débloquer le QR' : 'Ajoute IBAN et pièce'}
        </button>
        <div style={{ fontSize: 9, color: T.mu, lineHeight: 1.45, marginTop: 10 }}>
          Le fichier est envoyé dans le bucket privé KYC. L'IBAN complet n'est pas stocké en clair dans la table profil. Le retrait reste bloqué jusqu'à la vérification du dossier.
        </div>
      </div>
    </div>
  );
}

function ProfilCard({
  fullName,
  ville,
  phone,
  isMicro,
  bio,
  skills,
  onSave,
}: {
  fullName: string;
  ville: string;
  phone: string;
  isMicro: boolean;
  bio: string;
  skills: string[];
  onSave: (updates: ProfileUpdate) => Promise<void>;
}) {
  const [name, setName] = useState(fullName);
  const [micro, setMicro] = useState(isMicro);
  const [cityText, setCityText] = useState(ville);
  const [phoneText, setPhoneText] = useState(phone);
  const [bioText, setBioText] = useState(bio);
  const [skillsText, setSkillsText] = useState(skills.join(', '));
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Nom complet</div>
      <input aria-label="Nom complet" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inp, marginBottom: 12 }} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Ville</div>
          <input aria-label="Ville" value={cityText} onChange={(e) => setCityText(e.target.value)} placeholder="Lille" style={{ ...inp, marginBottom: 0 }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Téléphone</div>
          <input aria-label="Téléphone" value={phoneText} onChange={(e) => setPhoneText(e.target.value)} placeholder="06 12 34 56 78" inputMode="tel" style={{ ...inp, marginBottom: 0 }} />
        </div>
      </div>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Bio (visible sur ton CV vivant)</div>
      <textarea
        aria-label="Bio"
        value={bioText}
        onChange={(e) => setBioText(e.target.value)}
        rows={2}
        placeholder="En deux mots, qui tu es et ce que tu cherches…"
        style={{ ...inp, resize: 'none', lineHeight: 1.5, marginBottom: 12 }}
      />
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Compétences (séparées par des virgules)</div>
      <input
        aria-label="Compétences"
        value={skillsText}
        onChange={(e) => setSkillsText(e.target.value)}
        placeholder="service, caisse, manutention…"
        style={{ ...inp, marginBottom: 12 }}
      />
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Statut</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
        <button onClick={() => setMicro(false)} style={{ background: !micro ? '#fff' : T.row, color: !micro ? '#000' : T.sub, border: `1px solid ${!micro ? '#fff' : T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
          Particulier
        </button>
        <button onClick={() => setMicro(true)} style={{ background: micro ? '#fff' : T.row, color: micro ? '#000' : T.sub, border: `1px solid ${micro ? '#fff' : T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
          Micro-entrepreneur
        </button>
      </div>
      <div style={{ fontSize: 9.5, color: T.mu, lineHeight: 1.5, marginBottom: 12 }}>
        Si tu n'es pas micro-entrepreneur, le plafond légal de 3 jours consécutifs chez la même structure s'applique automatiquement.
      </div>
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await onSave({
              full_name: name,
              is_micro_entrepreneur: micro,
              city: cityText.trim() || null,
              phone: phoneText.trim() || null,
              bio: bioText.trim() || null,
              skills: skillsText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, 12),
            });
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        style={{ width: '100%', background: busy ? T.row : '#fff', color: busy ? T.mu : '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer' }}
      >
        {busy ? '…' : 'Enregistrer'}
      </button>
    </div>
  );
}
