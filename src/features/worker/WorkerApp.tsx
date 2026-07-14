import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { signOut } from '@/features/auth/authService';
import { submitWorkerKyc, updateProfile, uploadIdentityDocument, type Profile } from '@/features/profile/profileService';
import { T, FONT, inp } from '@/components/ui/theme';
import { Fld } from '@/components/ui/Fld';
import { QRBadge } from '@/components/ui/QRBadge';
import { Stars } from '@/components/ui/Stars';
import { DocModal, AideRegles, type DocKey } from '@/components/ui/DocModal';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ChatSheet } from '@/components/ui/ChatSheet';
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
  type ApplicationWithMission,
} from '@/features/missions/applicationsService';
import { rate, fetchStructureRatings, fetchWorkerReceivedRatings, type StructureRating } from '@/features/missions/ratingsService';
import { notifyDelay } from '@/features/missions/feedbackService';
import {
  attendanceEventLabel,
  createAttendanceQR,
  fetchAttendanceEvents,
  reportMissionIssue,
  requestRemoteAttendance,
  type AttendanceEvent,
} from '@/features/missions/attendanceService';
import { fetchUnreadCounts } from '@/features/messages/messagesService';
import { fetchWorkerStats, type WorkerStats } from '@/features/stats/statsService';
import { fetchCommissionRates, type CommissionRates } from '@/features/pricing/pricingService';
import { PriceSplit, splitPrice } from '@/components/ui/PriceSplit';
import { distanceKm, formatDistance, type LatLng } from '@/lib/geo';
import { formatDay, groupByDay, scheduleSummary } from '@/lib/slots';
import { formatEuros, formatHours } from '@/lib/format';

type Tab = 'flux' | 'moi' | 'profil';

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

const SHEET = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 } as const;
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

function normalizeIban(value: string): string {
  return value.replace(/\s/g, '').toUpperCase();
}

export function WorkerApp() {
  const { session, profile, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>('flux');
  const [flux, setFlux] = useState<MissionWithStructure[]>([]);
  const [apps, setApps] = useState<ApplicationWithMission[]>([]);
  const [attendance, setAttendance] = useState<Map<string, AttendanceEvent[]>>(new Map());
  const [receivedRatings, setReceivedRatings] = useState<Map<string, number>>(new Map());
  const [structRatings, setStructRatings] = useState<Map<string, StructureRating>>(new Map());
  const [unread, setUnread] = useState<Map<string, number>>(new Map());
  const [stats, setStats] = useState<WorkerStats | null>(null);
  const [rates, setRates] = useState<CommissionRates | null>(null);
  const [showPriceDetail, setShowPriceDetail] = useState(false);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MissionWithStructure | null>(null);
  const [structSheet, setStructSheet] = useState<MissionWithStructure | null>(null);
  const [ratingFor, setRatingFor] = useState<ApplicationWithMission | null>(null);
  const [structureRatingScore, setStructureRatingScore] = useState<number | null>(null);
  const [structureRatingNote, setStructureRatingNote] = useState('');
  const [chatFor, setChatFor] = useState<ApplicationWithMission | null>(null);
  const [alrt, setAlrt] = useState<{ app: ApplicationWithMission; type: 'retard' | 'annulation' } | null>(null);
  const [kycFor, setKycFor] = useState<ApplicationWithMission | null>(null);
  const [signal, setSignal] = useState<ApplicationWithMission | null>(null);
  const [sigMotif, setSigMotif] = useState<string | null>(null);
  const [sigNote, setSigNote] = useState('');
  const [qrFor, setQrFor] = useState<{ app: ApplicationWithMission; type: 'start' | 'end'; token: string; expiresAt: string } | null>(null);
  const [docKey, setDocKey] = useState<DocKey | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const tr = useRef<ReturnType<typeof setTimeout>>();

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
      const [missions, myApps, received, myStats] = await Promise.all([
        fetchOpenMissions(),
        fetchMyApplications(session.user.id),
        fetchWorkerReceivedRatings(session.user.id),
        fetchWorkerStats().catch(() => null),
      ]);
      setFlux(missions);
      setApps(myApps);
      setReceivedRatings(received);
      if (myStats) setStats(myStats);
      const structureIds = [...new Set(missions.map((m) => m.structure_id))];
      setStructRatings(await fetchStructureRatings(structureIds));
      const activeIds = myApps.filter((a) => ['accepted', 'in_progress', 'payment_pending', 'completed'].includes(a.status)).map((a) => a.id);
      const [unreadMap, attendanceMap] = await Promise.all([
        fetchUnreadCounts(activeIds, session.user.id),
        fetchAttendanceEvents(myApps.map((a) => a.id)).catch(() => new Map<string, AttendanceEvent[]>()),
      ]);
      setUnread(unreadMap);
      setAttendance(attendanceMap);
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
  useEffect(() => {
    const channel = subscribeToMissionFeed(() => {
      load();
    });
    return () => unsubscribeMissionFeed(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Taux de commission (configurés dans Supabase) pour « Tu recevras ».
  useEffect(() => {
    fetchCommissionRates().then(setRates).catch(() => undefined);
  }, []);

  // Réinitialise le toggle « Détail du montant » à chaque mission ouverte.
  useEffect(() => {
    setShowPriceDetail(false);
  }, [detail?.id]);

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
  const acceptedApps = apps.filter((a) => a.status === 'accepted' || a.status === 'in_progress' || a.status === 'payment_pending');
  const pendingCount = apps.filter((a) => a.status === 'pending').length;
  const completedApps = apps.filter((a) => a.status === 'completed');
  const cvCount = completedApps.length;
  const receivedScores = completedApps.map((a) => receivedRatings.get(a.id)).filter((s): s is number => Boolean(s));
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
      notif('✓ Candidature envoyée. Elle apparaîtra dans Missions si la structure accepte.');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Impossible de postuler.');
    } finally {
      setBusyId(null);
    }
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
      await load();
      notif('Avis enregistré anonymement. Il sera publié un lundi dès qu’un lot de 3 avis sera constitué.');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Notation impossible.');
    } finally {
      setRatingFor(null);
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

  async function afficherQr(app: ApplicationWithMission, type: 'start' | 'end') {
    if (!isKycReady(profile)) {
      setKycFor(app);
      notif('Ajoute ton IBAN et ta pièce pour débloquer le pointage.');
      return;
    }
    try {
      const created = await createAttendanceQR(app.id, type);
      setQrFor({ app, type, token: created.token, expiresAt: created.expires_at });
      await load();
    } catch (e) {
      notif(e instanceof Error ? e.message : 'QR impossible à générer.');
    }
  }

  async function demanderValidationDistance() {
    if (!qrFor) return;
    try {
      await requestRemoteAttendance(qrFor.app.id, qrFor.type, 'QR impossible à scanner');
      setQrFor(null);
      await load();
      notif('Demande envoyée à la structure.');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Demande impossible.');
    }
  }

  // Carte volontairement épurée : titre, structure + étoiles, ville, date,
  // horaires, durée, montant, « Voir la mission ». Le détail (commission,
  // planning complet…) n'apparaît qu'après le clic.
  function fluxCard(m: MissionWithStructure) {
    const sr = structRatings.get(m.structure_id);
    const dist = missionDistance(m);
    return (
      <div key={m.id} onClick={() => setDetail(m)} style={{ background: T.card, border: `1px solid ${m.is_solidaire ? '#14532d' : T.cb}`, borderRadius: 14, cursor: 'pointer', overflow: 'hidden' }}>
        <div style={{ padding: '15px 15px 12px' }}>
          {m.is_solidaire ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: T.green, letterSpacing: -1 }}>Solidaire</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: T.sub }}>0 €</span>
            </div>
          ) : (
            <div style={{ fontSize: 30, fontWeight: 900, color: T.text, letterSpacing: -1.5, lineHeight: 1, marginBottom: 6 }}>{euros(m.worker_rate_cents)}</div>
          )}
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>{m.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
            <span
              onClick={(e) => {
                e.stopPropagation();
                setStructSheet(m);
              }}
              style={{ fontSize: 11, fontWeight: 700, color: T.sub, textDecoration: 'underline', textDecorationColor: T.cb, cursor: 'pointer' }}
            >
              {m.structure?.name ?? 'Structure'}
            </span>
            {sr && (
              <>
                <Stars n={sr.average} size={11} />
                <span style={{ fontSize: 10, color: T.mu }}>{sr.average.toFixed(1).replace('.', ',')}</span>
              </>
            )}
          </div>
          <div style={{ fontSize: 10.5, color: T.mu }}>
            📍 {m.city || 'MEL'}
            {dist != null && <span style={{ color: T.cyan, fontWeight: 700 }}> · {formatDistance(dist)}</span>}
            {' · '}
            {scheduleSummary(m.slots, m.scheduled_date, m.start_time)} · {formatHours(m.duration_minutes)}
            {m.places > 1 ? ` · ${m.places} places` : ''}
          </div>
        </div>
        <div style={{ padding: '0 15px 13px' }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDetail(m);
            }}
            style={{ width: '100%', background: T.row, color: T.text, border: `1px solid ${T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}
          >
            Voir la mission
          </button>
        </div>
      </div>
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

        <div style={{ padding: '10px 12px', flex: 1 }}>
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
              {pendingCount > 0 && (
                <div style={{ fontSize: 10, color: T.mu, textAlign: 'center', padding: '2px 0' }}>
                  {pendingCount} candidature{pendingCount > 1 ? 's' : ''} en attente de réponse des structures
                </div>
              )}
              {acceptedApps.length === 0 && (
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
                const endDone = Boolean(a.actual_end_at);
                const paymentPending = a.status === 'payment_pending';
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 900, color: startDone ? T.green : T.text }}>Début de mission</div>
                          <div style={{ fontSize: 9.5, color: T.mu, marginTop: 2 }}>
                            {startDone ? `Confirmé à ${new Date(a.actual_start_at || a.checked_in_at || '').toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'QR temporaire, valable 10 min'}
                          </div>
                        </div>
                        {!startDone && (
                          <button onClick={() => afficherQr(a, 'start')} style={{ background: '#fff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 10px', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>
                            {kycIsReady ? 'Afficher mon QR' : 'Ajouter IBAN + pièce'}
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 900, color: endDone ? T.green : startDone ? T.text : T.mu }}>Fin de mission</div>
                          <div style={{ fontSize: 9.5, color: T.mu, marginTop: 2 }}>
                            {endDone
                              ? `Confirmée à ${new Date(a.actual_end_at || '').toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                              : startDone
                                ? 'Disponible depuis la confirmation du début'
                                : 'Disponible après le début'}
                          </div>
                        </div>
                        {startDone && !endDone && (
                          <button onClick={() => afficherQr(a, 'end')} style={{ background: T.grad, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 10px', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>
                            QR de fin
                          </button>
                        )}
                      </div>
                      {a.delay_minutes > 0 && (
                        <div style={{ marginTop: 8, fontSize: 9.5, color: a.delay_minutes <= 5 ? T.amber : T.red }}>
                          Retard calculé : {a.delay_minutes} min · {a.delay_status === 'tolerated' ? 'toléré' : a.delay_status}
                        </div>
                      )}
                      {paymentPending && (
                        <div style={{ marginTop: 8, fontSize: 9.5, color: T.cyan }}>
                          Mission terminée · paiement préparé pour J+3.
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 7 }}>
                      <button onClick={() => setAlrt({ app: a, type: 'retard' })} style={{ background: T.amberBg, color: T.amber, border: `1px solid ${T.amberBorder}`, borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        ⏱ Retard
                      </button>
                      <button onClick={() => setAlrt({ app: a, type: 'annulation' })} style={{ background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        ✕ Annuler
                      </button>
                    </div>
                    {endDone ? (
                      <div style={{ width: '100%', background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 900, textAlign: 'center', marginBottom: 6 }}>
                        Fin enregistrée · paiement en préparation
                      </div>
                    ) : (
                      <button
                        onClick={() => afficherQr(a, startDone ? 'end' : 'start')}
                        style={{ width: '100%', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer', marginBottom: 6 }}
                      >
                        {kycIsReady ? (startDone ? 'Afficher mon QR de fin' : 'Afficher mon QR de début') : 'Ajouter IBAN + pièce pour pointer'}
                      </button>
                    )}
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginBottom: 13 }}>
                  {[
                    ['Missions prouvées', String(cvCount)],
                    ['Note moyenne', receivedAvg ? `★ ${receivedAvg.toFixed(1).replace('.', ',')}` : '—'],
                    ['Gains totaux', stats ? euros(stats.earnings_total_cents) : '—'],
                  ].map(([l, v]) => (
                    <div key={l} style={{ background: T.row, borderRadius: 9, padding: '11px 6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: T.text }}>{v}</div>
                      <div style={{ fontSize: 8.5, color: T.mu, marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>
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
                {completedApps.length === 0 && <div style={{ fontSize: 11, color: T.mu }}>Tes missions terminées apparaîtront ici, avec la note donnée par la structure.</div>}
                {completedApps.map((a, i) => {
                  const score = receivedRatings.get(a.id);
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
                        {score ? <Stars n={score} size={10} /> : <span style={{ fontSize: 9, color: T.mu }}>pas encore notée</span>}
                        <span style={{ fontSize: 9, fontWeight: 800, color: T.green }}>✓</span>
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
              <WalletCard profileId={session.user.id} mode="worker" notif={notif} />
              {stats && stats.monthly.length > 0 && (
                <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Mes gains par mois</div>
                  {stats.monthly.map((m) => (
                    <div key={m.month} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '4px 0' }}>
                      <span style={{ color: T.sub }}>
                        {m.month} · {m.missions} mission{m.missions > 1 ? 's' : ''}
                      </span>
                      <span style={{ color: T.green, fontWeight: 800 }}>{euros(m.earnings_cents)}</span>
                    </div>
                  ))}
                  {stats.bonus_total_cents > 0 && (
                    <div style={{ fontSize: 10, color: '#facc15', marginTop: 6 }}>⚡ dont {euros(stats.bonus_total_cents)} de bonus (rémunérations boostées)</div>
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
        <div style={{ borderTop: `1px solid ${T.cb}`, padding: '6px 10px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, position: 'sticky', bottom: 0, background: T.bg }}>
          {(
            [
              ['flux', '🗂', 'Flux'],
              ['moi', '👤', 'Missions'],
              ['profil', '⚙️', 'Profil'],
            ] as [Tab, string, string][]
          ).map(([k, ic, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 0', borderRadius: 8, border: 'none', cursor: 'pointer', background: tab === k ? '#fff' : 'transparent', color: tab === k ? '#000' : T.mu, position: 'relative' }}>
              <span style={{ fontSize: 14 }}>{ic}</span>
              <span style={{ fontSize: 10, fontWeight: 700 }}>{l}</span>
              {k === 'moi' && (acceptedApps.length > 0 || unreadTotal > 0) && (
                <span style={{ position: 'absolute', top: 4, right: 14, minWidth: 6, height: unreadTotal > 0 ? 14 : 6, borderRadius: 8, background: unreadTotal > 0 ? '#dc2626' : T.cyan, color: '#fff', fontSize: 8.5, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: unreadTotal > 0 ? '0 4px' : 0 }}>
                  {unreadTotal > 0 ? unreadTotal : ''}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Détail mission */}
        {detail && (
          <div style={SHEET} onClick={() => setDetail(null)}>
            <div style={{ ...SHEET_BODY, maxHeight: '76vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <button onClick={() => setDetail(null)} style={{ background: T.row, border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', color: T.sub, fontSize: 13 }}>×</button>
              </div>
              {detail.is_solidaire ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 24, fontWeight: 900, color: T.green, letterSpacing: -1 }}>Mission solidaire</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: T.sub }}>0 €</span>
                </div>
              ) : (
                <div style={{ fontSize: 30, fontWeight: 900, color: T.text, letterSpacing: -2, marginBottom: 4 }}>{euros(detail.worker_rate_cents)}</div>
              )}
              <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 10 }}>{detail.title}</div>
              {!detail.is_solidaire && rates && (
                <div style={{ fontSize: 12.5, fontWeight: 800, color: T.green, marginBottom: 10 }}>
                  Tu recevras : {euros(splitPrice(detail.worker_rate_cents, rates.structurePct, rates.workerPct).netWorkerCents)}
                  <button
                    onClick={() => setShowPriceDetail((v) => !v)}
                    style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10.5, color: T.mu, textDecoration: 'underline', fontWeight: 600 }}
                  >
                    {showPriceDetail ? 'Masquer le détail' : 'Détail du montant'}
                  </button>
                </div>
              )}
              {!detail.is_solidaire && showPriceDetail && rates && (
                <>
                  <PriceSplit values={splitPrice(detail.worker_rate_cents, rates.structurePct, rates.workerPct)} side="worker" />
                  {detail.pricing_breakdown && detail.pricing_breakdown.adjustments.length > 0 && <PricingDetails breakdown={detail.pricing_breakdown} compact />}
                </>
              )}
              <div
                onClick={() => {
                  setStructSheet(detail);
                  setDetail(null);
                }}
                style={{ background: T.row, borderRadius: 11, padding: '12px 13px', marginBottom: 11, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{detail.structure?.name ?? 'Structure'}</span>
                  {(() => {
                    const sr = structRatings.get(detail.structure_id);
                    return sr ? <Stars n={sr.average} size={11} /> : null;
                  })()}
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: T.cyan, fontWeight: 700 }}>Voir la fiche ›</span>
                </div>
                <div style={{ fontSize: 11, color: T.sub }}>
                  📍 {detail.city || 'MEL'}
                  {(() => {
                    const d = missionDistance(detail);
                    return d != null ? ` (à ${formatDistance(d)})` : '';
                  })()}
                </div>
              </div>
              {/* Planning par journée */}
              <div style={{ background: T.row, borderRadius: 11, padding: '12px 13px', marginBottom: 11 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Planning</div>
                {detail.slots && detail.slots.length > 0 ? (
                  groupByDay(detail.slots).map((day) => (
                    <div key={day.date} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: T.sub, padding: '3px 0' }}>
                      <span style={{ fontWeight: 700, color: T.text }}>{formatDay(day.date)}</span>
                      <span>{day.ranges.join(' · ')}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 11.5, color: T.sub }}>
                    {detail.scheduled_date}
                    {detail.start_time ? ` · ${detail.start_time.slice(0, 5)}` : ''}
                  </div>
                )}
                <div style={{ fontSize: 10, color: T.mu, marginTop: 5 }}>
                  Durée totale : {formatHours(detail.duration_minutes)}
                  {detail.places > 1 ? ` · ${detail.places} places` : ''}
                </div>
              </div>
              {detail.detail && <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.55, marginBottom: 13 }}>{detail.detail}</div>}
              <button
                onClick={() => postuler(detail)}
                style={{ width: '100%', background: detail.is_solidaire ? '#16a34a' : '#fff', color: detail.is_solidaire ? '#fff' : '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 900, cursor: 'pointer' }}
              >
                {detail.is_solidaire ? '🤝 Participer à la mission' : 'Accepter la mission'}
              </button>
            </div>
          </div>
        )}

        {/* Fiche structure */}
        {structSheet && (
          <div style={SHEET} onClick={() => setStructSheet(null)}>
            <div style={{ ...SHEET_BODY, maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', gap: 11, alignItems: 'center', marginBottom: 13 }}>
                <div style={{ width: 48, height: 48, borderRadius: 13, background: 'hsl(200 30% 18%)', border: '2px solid hsl(200 30% 30%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 14 }}>
                  {(structSheet.structure?.name ?? 'S')
                    .split(' ')
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: T.text }}>{structSheet.structure?.name ?? 'Structure'}</div>
                  {(() => {
                    const sr = structRatings.get(structSheet.structure_id);
                    return sr ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        <Stars n={sr.average} size={12} />
                        <span style={{ fontSize: 12, fontWeight: 800, color: T.text }}>{sr.average.toFixed(1).replace('.', ',')}</span>
                        <span style={{ fontSize: 10, color: T.mu }}>({sr.count} avis)</span>
                      </div>
                    ) : (
                      <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 700, color: T.cyan, background: '#22d3ee15', borderRadius: 8, padding: '2px 7px', marginTop: 4 }}>Nouvelle · pas encore classée</span>
                    );
                  })()}
                </div>
                <button onClick={() => setStructSheet(null)} style={{ background: T.row, border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', color: T.sub, fontSize: 13 }}>×</button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {structSheet.structure?.is_ess && <span style={{ fontSize: 10, fontWeight: 800, color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 20, padding: '3px 10px' }}>🤝 Association · ESS</span>}
                {structSheet.structure?.siret && <span style={{ fontSize: 10, fontWeight: 800, color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 20, padding: '3px 10px' }}>✓ SIRET {structSheet.structure.siret}</span>}
              </div>
              {structSheet.structure?.about && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: T.text, marginBottom: 5 }}>À propos</div>
                  <div style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.6 }}>{structSheet.structure.about}</div>
                </div>
              )}
              <div style={{ fontSize: 10, color: T.mu, lineHeight: 1.5 }}>
                Les notes sont données par les travailleurs après chaque mission terminée. Elles sont informatives et jamais bloquantes.
              </div>
            </div>
          </div>
        )}

        {/* Retard / Annulation */}
        {alrt && (
          <div style={SHEET} onClick={() => setAlrt(null)}>
            <div style={SHEET_BODY} onClick={(e) => e.stopPropagation()}>
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

        {/* QR debut / fin */}
        {qrFor && (
          <div style={{ ...SHEET, background: 'rgba(0,0,0,.92)' }} onClick={() => setQrFor(null)}>
            <div style={{ ...SHEET_BODY, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 15, fontWeight: 900, color: T.text, marginBottom: 4 }}>
                {qrFor.type === 'start' ? 'QR de début de mission' : 'QR de fin de mission'}
              </div>
              <div style={{ fontSize: 10.5, color: T.sub, lineHeight: 1.5, marginBottom: 13 }}>
                Fais scanner ce QR avec l’appareil photo du responsable. Il expire à {new Date(qrFor.expiresAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.
              </div>
              <div style={{ display: 'inline-flex', background: '#fff', borderRadius: 14, padding: 12, marginBottom: 12 }}>
                <QRBadge value={`${window.location.origin}/scan/${qrFor.token}`} size={190} />
              </div>
              <button onClick={demanderValidationDistance} style={{ width: '100%', background: '#1d4ed815', color: '#93c5fd', border: '1px solid #1e40af', borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer', marginBottom: 7 }}>
                Problème de scan · demander une validation à distance
              </button>
              <button onClick={() => { setSignal(qrFor.app); setQrFor(null); }} style={{ width: '100%', background: T.row, color: T.sub, border: `1px solid ${T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Aucun responsable présent / autre problème
              </button>
            </div>
          </div>
        )}

        {/* Signalement */}
        {signal && (
          <div style={SHEET} onClick={() => { setSignal(null); setSigMotif(null); setSigNote(''); }}>
            <div style={{ ...SHEET_BODY, maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
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
          <div style={{ ...SHEET, background: 'rgba(0,0,0,.92)' }}>
            <div style={SHEET_BODY} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: T.greenBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>✓</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: T.green }}>Mission terminée !</div>
                  <div style={{ fontSize: 10, color: T.mu }}>{ratingFor.mission?.title}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: T.sub, marginBottom: 4 }}>
                Cette mission rejoint ton CV vivant et ton paiement est crédité sur ton wallet. La structure te notera de son côté — sa note apparaîtra dans ton historique (informative, jamais bloquante).
              </div>
              <div style={{ fontSize: 12, color: T.text, fontWeight: 700, marginBottom: 9 }}>Note la structure :</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} aria-label={`${n} étoile${n > 1 ? 's' : ''}`} onClick={() => setStructureRatingScore(n)} style={{ flex: 1, padding: '12px 0', fontSize: 22, background: structureRatingScore === n ? T.amberBg : T.row, border: `1px solid ${structureRatingScore === n ? T.amberBorder : T.cb}`, borderRadius: 10, cursor: 'pointer', color: '#f59e0b' }}>
                    ★
                  </button>
                ))}
              </div>
              <textarea
                aria-label="Commentaire anonyme"
                value={structureRatingNote}
                onChange={(event) => setStructureRatingNote(event.target.value.slice(0, 280))}
                rows={3}
                placeholder="Ajoute une courte note facultative…"
                style={{ ...inp, resize: 'none', lineHeight: 1.5, marginBottom: 5 }}
              />
              <div style={{ color: T.mu, fontSize: 9, marginBottom: 10 }}>{structureRatingNote.length}/280 · Publication anonyme un lundi, uniquement par lots de 3 avis.</div>
              <button onClick={noterStructure} disabled={structureRatingScore == null} style={{ width: '100%', background: structureRatingScore == null ? T.row : '#fff', color: structureRatingScore == null ? T.mu : '#000', border: 'none', borderRadius: 9, padding: '11px 0', fontSize: 12, fontWeight: 900, cursor: structureRatingScore == null ? 'not-allowed' : 'pointer', marginBottom: 6 }}>
                Envoyer anonymement
              </button>
              <button onClick={() => { setRatingFor(null); setStructureRatingScore(null); setStructureRatingNote(''); }} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.mu, padding: '4px 0' }}>
                Passer
              </button>
            </div>
          </div>
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
      setError(e instanceof Error ? e.message : 'Envoi impossible.');
    } finally {
      if (!saved) setBusy(false);
    }
  }

  return (
    <div style={SHEET} onClick={onClose}>
      <div style={SHEET_BODY} onClick={(e) => e.stopPropagation()}>
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
