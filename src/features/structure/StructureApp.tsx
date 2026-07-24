import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { hasFounderAccess, signOut } from '@/features/auth/authService';
import { T, FONT, inp } from '@/components/ui/theme';
import { Fld } from '@/components/ui/Fld';
import { DocModal, AideRegles, type DocKey } from '@/components/ui/DocModal';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ChatSheet } from '@/components/ui/ChatSheet';
import { useBodyScrollLock } from '@/components/ui/useBodyScrollLock';
import { WalletCard } from '@/components/ui/WalletCard';
import { fetchMyStructures, createStructure, updateStructureAbout } from './structureService';
import { StatsPanel, StructureStatsSummary, StructurePerformances } from './StatsPanel';
import { StructureHistoryPanel } from './StructureHistoryPanel';
import { fetchMissionsForStructure, createMission, updateMission, cancelMission, replaceMissionWorker, notifyReplacementSearch, type MissionNonSensitivePatch } from '@/features/missions/missionsService';
import {
  fetchApplicationsForMissions,
  updateApplicationStatus,
  subscribeToApplicationsFeed,
  unsubscribeApplicationsFeed,
  type ApplicationWithApplicant,
} from '@/features/missions/applicationsService';
import {
  rate,
  fetchRatedApplicationIds,
  fetchGivenRatingScores,
  fetchWorkerReputation,
  fetchPendingRatingRequests,
  snoozeRatingRequest,
  shouldPromptRatingRequest,
  type WorkerReputation,
  type RatingRequest,
} from '@/features/missions/ratingsService';
import { fetchDelaysForApplications } from '@/features/missions/feedbackService';
import { confirmRemoteAttendance, reportWorkerAbsence, reportMissionIssue } from '@/features/missions/attendanceService';
import { verifyMissionCvEntry, disputeMissionCvEntry } from '@/features/missions/missionCvService';
import { MissionValidationPanel } from '@/features/missions/MissionValidationPanel';
import { StructureQrScanSheet } from '@/features/missions/StructureQrScanSheet';
import { createMissionCheckout, requestMissionRefund } from '@/features/payments/stripeService';
import { isStripeConfigured } from '@/lib/env';
import { fetchUnreadCounts } from '@/features/messages/messagesService';
import { geocodeMelCity } from '@/lib/geo';
import { distinctDays, slotMinutes, spanDays, totalMinutes } from '@/lib/slots';
import { formatSiret, isValidSiret, normalizeSiret } from '@/features/structure/verification';
import type { Mission, Structure } from '@/features/missions/types';
import type { MissionDayOfWeek, MissionSlot, MissionTimeSlot } from '@/types/database.types';
import { formatEuros, formatHours } from '@/lib/format';
import { describeError } from '@/lib/errors';

type Tab = 'missions' | 'candidats' | 'habitues' | 'historique';
const DEFAULT_HOURLY_EUR = 14;
const MIN_HOURLY_EUR = 10;
const MAX_HOURLY_EUR = 80;
const SERVICE_FEE_RATE = 0.18;
const MAX_MISSION_MINUTES = 4320;
type RateMode = 'hourly' | 'fixed';

const SLOT_SHORTCUTS: Array<{ label: string; start: string; end: string }> = [
  { label: 'Matin', start: '08:00', end: '12:00' },
  { label: 'Après-midi', start: '13:00', end: '17:00' },
  { label: 'Soir', start: '18:00', end: '23:00' },
  { label: 'Nuit', start: '22:00', end: '03:00' },
];

const MISSION_CATEGORIES = [
  ['renfort_service', 'Renfort service'],
  ['runner', 'Runner'],
  ['accueil', 'Accueil'],
  ['inventaire', 'Inventaire'],
  ['distribution', 'Distribution'],
  ['autre', 'Autre'],
] as const;

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateTime(date: string, time: string, addDay = false): Date {
  const d = new Date(`${date}T${time}:00`);
  if (addDay) d.setDate(d.getDate() + 1);
  return d;
}

function slotStartsAt(slot: MissionSlot): Date {
  return dateTime(slot.date, slot.start);
}

function slotEndsAt(slot: MissionSlot): Date {
  return dateTime(slot.date, slot.end, slot.end < slot.start);
}

function firstSlot(slots: MissionSlot[]): MissionSlot | null {
  return slots.slice().sort((a, b) => slotStartsAt(a).getTime() - slotStartsAt(b).getTime())[0] ?? null;
}

function lastSlot(slots: MissionSlot[]): MissionSlot | null {
  return slots.slice().sort((a, b) => slotEndsAt(b).getTime() - slotEndsAt(a).getTime())[0] ?? null;
}

function formatMoney(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

function formatHoursCompact(hours: number): string {
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1).replace('.', ',')} h`;
}

function formatLongDay(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function dayOfWeek(date: string): MissionDayOfWeek {
  const days: MissionDayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[new Date(`${date}T00:00:00`).getDay()] ?? 'monday';
}

function inferTimeSlot(slots: MissionSlot[]): MissionTimeSlot {
  if (slots.some((slot) => slot.end < slot.start)) return 'night';
  const first = firstSlot(slots);
  const hour = Number(first?.start.slice(0, 2) ?? 12);
  if (hour < 12 && hour >= 5) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

type CandWithMission = ApplicationWithApplicant & { missionTitle: string };

// Bucket derive du statut REEL de la candidature active sur la mission (pas
// du statut de la mission elle-meme, qui reste open/closed/cancelled) : le
// menu contextuel a trois points affiche uniquement les actions autorisees
// pour cet etat, jamais de messagerie active une fois la mission terminee.
// 'accepted' (candidat retenu, pas encore demarre) et 'in_progress' (QR de
// debut deja confirme) sont deux buckets distincts : le pointage (icone QR)
// n'a de sens que pour ces deux-la, jamais pour une mission sans candidat ou
// deja terminee/annulee.
type MissionBucket = 'cancelled' | 'completed' | 'in_progress' | 'accepted' | 'open';
type ManageMode = 'menu' | 'edit' | 'cancel' | 'summary' | 'replace';
interface ManageState {
  mission: Mission;
  mode: ManageMode;
}

function isVerifiedStructure(structure: Structure | null): boolean {
  if (!structure) return false;
  return structure.verification_status === 'verified' || structure.verification_status === 'founder_bypass';
}

function verificationBadge(structure: Structure): { label: string; color: string; bg: string } {
  if (structure.verification_status === 'founder_bypass' || structure.founder_bypass) return { label: 'Accès fondateur', color: T.green, bg: T.greenBg };
  if (structure.verification_status === 'verified') return { label: '✓ SIRET vérifié', color: T.green, bg: T.greenBg };
  if (structure.verification_status === 'rejected') return { label: 'SIRET refusé', color: T.red, bg: T.redBg };
  return { label: 'Vérification SIRET', color: T.amber, bg: T.amberBg };
}

function statusPill(bucket: MissionBucket): { label: string; color: string; bg: string } {
  if (bucket === 'cancelled') return { label: 'Annulée', color: T.red, bg: T.redBg };
  if (bucket === 'completed') return { label: 'Terminée', color: T.cyan, bg: '#22d3ee15' };
  if (bucket === 'in_progress') return { label: 'En cours', color: T.green, bg: T.greenBg };
  if (bucket === 'accepted') return { label: 'Candidat retenu', color: T.green, bg: T.greenBg };
  return { label: 'Publiée', color: T.amber, bg: T.amberBg };
}

// Carte compacte (inspiree de la demo) : titre, creneau, prix, statut derive
// de la candidature la plus avancee, un petit bouton QR separe (jamais un QR
// de la structure : il OUVRE le scanner camera) visible uniquement quand le
// pointage est reellement pertinent (candidat retenu ou mission en cours),
// et un menu a trois points qui ouvre MissionManageSheet plutot qu'une pile
// de boutons toujours visibles.
function MissionCard({
  mission,
  bucket,
  candidateCount,
  onOpenCandidates,
  onOpenMenu,
  onScan,
}: {
  mission: Mission;
  bucket: MissionBucket;
  candidateCount: number;
  onOpenCandidates: () => void;
  onOpenMenu: () => void;
  onScan: () => void;
}) {
  const pill = statusPill(bucket);
  const slots = mission.slots ?? [];
  const first = firstSlot(slots);
  const last = lastSlot(slots);
  const canScan = bucket === 'accepted' || bucket === 'in_progress';
  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mission.title}</div>
          <div style={{ fontSize: 10, color: T.mu, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {first ? `${formatLongDay(first.date)} · ${first.start}–${last?.end ?? first.end}` : mission.city}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {canScan && (
            <button
              onClick={onScan}
              aria-label="Scanner le QR de pointage"
              title="Scanner le QR de pointage"
              style={{ background: '#22d3ee15', border: '1px solid #0e7490', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: T.cyan, fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <span aria-hidden="true">▦</span>
            </button>
          )}
          <button
            onClick={onOpenMenu}
            aria-label="Actions sur la mission"
            style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: T.sub, fontSize: 15, fontWeight: 900, lineHeight: 1 }}
          >
            •••
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: pill.color, background: pill.bg, borderRadius: 8, padding: '2px 7px' }}>{pill.label}</span>
        <span style={{ fontSize: 12, fontWeight: 900, color: T.text }}>{mission.is_solidaire ? 'Solidaire' : euros(mission.worker_rate_cents)}</span>
      </div>
      {bucket === 'open' && candidateCount > 0 && (
        <button onClick={onOpenCandidates} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontSize: 10.5, fontWeight: 800, color: T.amber }}>
          {candidateCount} candidature{candidateCount > 1 ? 's' : ''} à traiter →
        </button>
      )}
    </div>
  );
}

export function StructureApp() {
  const { session } = useAuth();
  const [structure, setStructure] = useState<Structure | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('missions');
  const [mis, setMis] = useState<Mission[]>([]);
  const [cands, setCands] = useState<Map<string, ApplicationWithApplicant[]>>(new Map());
  const [delays, setDelays] = useState<Map<string, number>>(new Map());
  const [ratedIds, setRatedIds] = useState<Set<string>>(new Set());
  const [unread, setUnread] = useState<Map<string, number>>(new Map());
  const [candMis, setCandMis] = useState<string | null>(null);
  const [showPub, setShowPub] = useState(false);
  const [validationMissionId, setValidationMissionId] = useState<string | null>(null);
  const [panelC, setPanelC] = useState<CandWithMission | null>(null);
  const [panelRep, setPanelRep] = useState<WorkerReputation | null>(null);
  const [ratingCand, setRatingCand] = useState<CandWithMission | null>(null);
  const [ratingRequests, setRatingRequests] = useState<RatingRequest[]>([]);
  const [autoRatingRequestId, setAutoRatingRequestId] = useState<string | null>(null);
  const [snoozedThisSession, setSnoozedThisSession] = useState<Set<string>>(new Set());
  const [chatFor, setChatFor] = useState<CandWithMission | null>(null);
  const [docKey, setDocKey] = useState<DocKey | null>(null);
  const [vf, setVf] = useState({ nom: '', siret: '' });
  const [founderAccess, setFounderAccess] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [manage, setManage] = useState<ManageState | null>(null);
  const [givenRatings, setGivenRatings] = useState<Map<string, number>>(new Map());
  const [duplicateSeed, setDuplicateSeed] = useState<Mission | null>(null);
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [scanMission, setScanMission] = useState<Mission | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const tr = useRef<ReturnType<typeof setTimeout>>();

  useBodyScrollLock(Boolean(showPub || validationMissionId || panelC || ratingCand || chatFor || docKey || manage || scanMission));

  function notif(m: string) {
    setToast(m);
    clearTimeout(tr.current);
    tr.current = setTimeout(() => setToast(null), 3000);
  }

  async function loadMissionData(missions: Mission[]) {
    if (!session) return;
    const candsByMission = await fetchApplicationsForMissions(missions.map((m) => m.id));
    setCands(candsByMission);
    const allApps = [...candsByMission.values()].flat();
    const appIds = allApps.map((a) => a.id);
    // Messages non lus : uniquement sur les fils encore ouverts. Une fois la
    // mission terminée, la messagerie se ferme (finalize_mission_end) et il
    // n'existe plus aucun moyen d'ouvrir ce fil pour le marquer lu — un
    // reliquat non lu y resterait sinon bloqué indéfiniment dans le badge.
    const openConversationIds = allApps.filter((a) => a.conversation_status === 'open').map((a) => a.id);
    const [delayMap, rated, unreadMap, pendingRatingRequests, given] = await Promise.all([
      fetchDelaysForApplications(appIds),
      fetchRatedApplicationIds(appIds, 'structure_to_worker'),
      fetchUnreadCounts(openConversationIds, session.user.id),
      fetchPendingRatingRequests(session.user.id).catch(() => [] as RatingRequest[]),
      fetchGivenRatingScores(appIds, 'structure_to_worker').catch(() => new Map<string, number>()),
    ]);
    setDelays(delayMap);
    setRatedIds(rated);
    setUnread(unreadMap);
    setRatingRequests(pendingRatingRequests);
    setGivenRatings(given);
  }

  async function reload() {
    if (!structure) return;
    const missions = await fetchMissionsForStructure(structure.id);
    setMis(missions);
    await loadMissionData(missions);
  }

  // Flux en direct : une nouvelle candidature (ou un changement de statut)
  // sur une mission de la structure met à jour l'onglet Candidats sans
  // recharger la page. Sans cet abonnement, seule la cloche de notifications
  // (canal séparé sur `notifications`) réagissait en direct.
  const missionIdsKey = mis.map((m) => m.id).sort().join(',');
  useEffect(() => {
    const missionIds = missionIdsKey ? missionIdsKey.split(',') : [];
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const channel = subscribeToApplicationsFeed(missionIds, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        loadMissionData(mis).catch(() => notif('Erreur de mise à jour des candidatures.'));
      }, 500);
    });
    return () => {
      clearTimeout(reloadTimer);
      unsubscribeApplicationsFeed(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionIdsKey]);

  useEffect(() => {
    (async () => {
      if (!session) return;
      try {
        // L'acces fondateur vient uniquement de Supabase. Une valeur locale
        // ne doit jamais piloter un contournement de verification en prod.
        const founder = await hasFounderAccess().catch(() => false);
        setFounderAccess(founder);
        let mine = await fetchMyStructures(session.user.id);
        if (mine.length === 0) {
          const meta = session.user.user_metadata as Record<string, string | boolean | null>;
          if (meta.structure_name) {
            const metaSiret = String(meta.siret ?? '');
            const metaSiretOk = isValidSiret(metaSiret);
            const created = await createStructure(
              session.user.id,
              String(meta.structure_name),
              founder && !metaSiretOk ? undefined : normalizeSiret(metaSiret),
              Boolean(meta.is_ess),
              {
                verificationStatus: founder ? 'founder_bypass' : metaSiretOk ? 'verified' : 'pending',
                verificationMethod: founder ? 'founder' : 'siret',
                founderBypass: founder,
              },
            );
            mine = [created];
          }
        }
        const st = mine[0] ?? null;
        setStructure(st);
        if (st) {
          const missions = await fetchMissionsForStructure(st.id);
          setMis(missions);
          await loadMissionData(missions);
        }
      } catch {
        notif('Erreur de chargement.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function createFromForm() {
    if (!session) return;
    const founder = founderAccess;
    const siretOk = isValidSiret(vf.siret);
    if (!(vf.nom.trim().length >= 2 && (founder || siretOk))) {
      notif('SIRET valide requis.');
      return;
    }
    try {
      const created = await createStructure(session.user.id, vf.nom.trim(), founder ? undefined : normalizeSiret(vf.siret), false, {
        verificationStatus: founder ? 'founder_bypass' : 'verified',
        verificationMethod: founder ? 'founder' : 'siret',
        founderBypass: founder,
      });
      setStructure(created);
      notif(founder ? '✓ Structure enregistrée avec accès fondateur.' : '✓ Structure enregistrée, SIRET vérifié.');
    } catch (e) {
      notif(describeError(e, 'la création de la structure'));
    }
  }

  async function decide(applicationId: string, dec: 'accepted' | 'rejected') {
    try {
      await updateApplicationStatus(applicationId, dec);
      await loadMissionData(mis);
      setPanelC(null);
      notif(dec === 'accepted' ? 'Candidat accepté — le fil de discussion est ouvert.' : 'Candidat refusé.');
    } catch (e) {
      notif(describeError(e, 'cette décision'));
    }
  }

  // Mission rémunérée : accepter un candidat passe OBLIGATOIREMENT par le
  // paiement Stripe. On redirige vers la Checkout Session hébergée ; c'est le
  // webhook (et lui seul) qui confirmera l'affectation. Une mission solidaire
  // ou un environnement sans Stripe configuré garde l'acceptation directe.
  function missionFor(candidate: CandWithMission): Mission | undefined {
    return mis.find((m) => m.id === candidate.mission_id);
  }

  function isPaidMission(mission: Mission | undefined): boolean {
    return Boolean(mission && !mission.is_solidaire && mission.worker_rate_cents > 0);
  }

  async function payAndConfirm(candidate: CandWithMission) {
    const mission = missionFor(candidate);
    if (!isStripeConfigured || !isPaidMission(mission)) {
      await decide(candidate.id, 'accepted');
      return;
    }
    try {
      setPayingId(candidate.id);
      const { url } = await createMissionCheckout(candidate.id);
      if (!url) throw new Error('URL de paiement indisponible.');
      window.location.assign(url); // redirection vers Stripe Checkout hébergé
    } catch (e) {
      setPayingId(null);
      notif(describeError(e, "l'ouverture du paiement"));
    }
  }

  function closeRatingModal(snooze: boolean) {
    if (snooze && autoRatingRequestId) {
      setSnoozedThisSession((prev) => new Set(prev).add(autoRatingRequestId));
      snoozeRatingRequest(autoRatingRequestId).catch(() => undefined);
    }
    setRatingCand(null);
    setAutoRatingRequestId(null);
  }

  async function noterTravailleur(score: number) {
    if (!structure || !ratingCand) return;
    try {
      await rate({
        applicationId: ratingCand.id,
        structureId: structure.id,
        workerId: ratingCand.worker_id,
        score,
        direction: 'structure_to_worker',
      });
      if (autoRatingRequestId) setSnoozedThisSession((prev) => new Set(prev).add(autoRatingRequestId));
      await loadMissionData(mis);
      notif('Note enregistrée. Elle sera visible une fois que les deux parties auront répondu (ou après quelques jours).');
    } catch (e) {
      notif(describeError(e, "l'enregistrement de la note"));
    } finally {
      setRatingCand(null);
      setAutoRatingRequestId(null);
    }
  }

  async function validerMissionCv(c: CandWithMission) {
    try {
      await verifyMissionCvEntry(c.id);
      await loadMissionData(mis);
      notif('Mission validée — elle passe en vert dans le CV du travailleur.');
    } catch (e) {
      notif(describeError(e, 'la validation'));
    }
  }

  async function contesterMissionCv(c: CandWithMission) {
    const reason = window.prompt('Motif de la contestation (visible par le travailleur) :');
    if (!reason || !reason.trim()) return;
    try {
      await disputeMissionCvEntry(c.id, reason.trim());
      await loadMissionData(mis);
      notif('Mission contestée — Support UROSI est informé.');
    } catch (e) {
      notif(describeError(e, "l'envoi de la contestation"));
    }
  }

  async function validationDistance(c: CandWithMission, type: 'start' | 'end') {
    try {
      await confirmRemoteAttendance(c.id, type);
      await loadMissionData(mis);
      notif(type === 'start' ? 'Début validé à distance.' : 'Fin validée à distance — paiement préparé pour J+3.');
    } catch (e) {
      notif(describeError(e, 'la validation à distance'));
    }
  }

  async function signalerAbsence(c: CandWithMission) {
    try {
      await reportWorkerAbsence(c.id, 'travailleur absent / impossible à joindre');
      await loadMissionData(mis);
      notif('Absence signalée — le travailleur peut répondre, aucune sanction automatique.');
    } catch (e) {
      notif(describeError(e, "le signalement de l'absence"));
    }
  }

  async function saveMissionEdit(missionId: string, patch: MissionNonSensitivePatch) {
    try {
      await updateMission(missionId, patch);
      await reload();
      setManage(null);
      notif('Informations mises à jour.');
    } catch (e) {
      notif(describeError(e, 'la modification de la mission'));
    }
  }

  async function confirmCancelMission(mission: Mission) {
    const active = (cands.get(mission.id) ?? []).filter((c) => ['pending', 'accepted', 'in_progress'].includes(c.status));
    // Mission confirmée (paiement Stripe encaissé) : on lance d'abord le
    // remboursement, puis on annule. Le webhook charge.refunded synchronise le
    // Wallet et repasse la candidature en remboursée. Mission non confirmée :
    // annulation immédiate, aucun remboursement nécessaire (Document 5).
    const paid = active.filter((c) => c.stripe_payment_status === 'paid');
    try {
      for (const c of paid) {
        if (isStripeConfigured) await requestMissionRefund(c.id);
      }
      await cancelMission(mission.id, active.map((c) => c.id));
      await reload();
      setManage(null);
      notif(
        paid.length > 0
          ? 'Mission annulée — remboursement Stripe lancé, le travailleur est prévenu.'
          : active.length > 0
            ? 'Mission annulée — le(s) travailleur(s) concerné(s) est/sont prévenu(s).'
            : 'Mission annulée.',
      );
    } catch (e) {
      notif(describeError(e, "l'annulation de la mission"));
    }
  }

  function startDuplicate(mission: Mission) {
    setDuplicateSeed(mission);
    setManage(null);
    setShowPub(true);
  }

  async function confirmReplace(oldApplicationId: string, newApplicationId: string) {
    try {
      await replaceMissionWorker(oldApplicationId, newApplicationId);
      await reload();
      setManage(null);
      notif('Remplaçant confirmé — le paiement est transféré, aucun nouveau règlement.');
    } catch (e) {
      notif(describeError(e, 'la confirmation du remplacement'));
    }
  }

  async function notifyNearbyForReplacement(missionId: string) {
    try {
      const count = await notifyReplacementSearch(missionId);
      notif(count > 0 ? `${count} travailleur${count > 1 ? 's' : ''} proche${count > 1 ? 's' : ''} prévenu${count > 1 ? 's' : ''}.` : 'Aucun travailleur proche à prévenir pour le moment.');
    } catch (e) {
      notif(describeError(e, "l'envoi des notifications"));
    }
  }

  async function signalerProbleme(applicationId: string) {
    const description = window.prompt('Décris brièvement le problème (visible par Support UROSI) :');
    if (!description || !description.trim()) return;
    try {
      await reportMissionIssue({ applicationId, category: 'autre', description: description.trim() });
      notif('Signalement transmis à Support UROSI.');
    } catch (e) {
      notif(describeError(e, "l'envoi du signalement"));
    } finally {
      setManage(null);
    }
  }

  async function openPanel(c: CandWithMission) {
    setPanelC(c);
    setPanelRep(null);
    try {
      setPanelRep(await fetchWorkerReputation(c.worker_id));
    } catch {
      setPanelRep({ average: null, count: 0 });
    }
  }

  const allCands: CandWithMission[] = mis.flatMap((m) => (cands.get(m.id) ?? []).map((c) => ({ ...c, missionTitle: m.title })));

  // Demande de note automatique (cote structure) : meme cadence que le
  // travailleur (prochaine connexion, puis 24h, 72h). "Me le rappeler plus
  // tard" ne supprime jamais la demande.
  useEffect(() => {
    if (ratingCand || !session) return;
    const due = ratingRequests.find((r) => !snoozedThisSession.has(r.id) && shouldPromptRatingRequest(r));
    if (!due) return;
    const cand = allCands.find((c) => c.id === due.applicationId);
    if (!cand) return;
    setAutoRatingRequestId(due.id);
    setRatingCand(cand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratingRequests, cands, mis, ratingCand, session]);

  const pending = [...new Map(allCands.filter((c) => c.status === 'pending').map((candidate) => [candidate.worker_id, candidate])).values()];
  const completedByWorker = new Map<string, CandWithMission[]>();
  for (const c of allCands.filter((x) => x.status === 'completed')) {
    completedByWorker.set(c.worker_id, [...(completedByWorker.get(c.worker_id) ?? []), c]);
  }
  const habitues = [...completedByWorker.entries()]
    .map(([workerId, list]) => ({ workerId, nom: list[0]?.profile?.full_name || 'Travailleur', fois: list.length }))
    .sort((a, b) => b.fois - a.fois);
  const candidatePool = candMis ? allCands.filter((c) => c.mission_id === candMis) : allCands;
  const shownCands = [...new Map(candidatePool.map((candidate) => [candidate.worker_id, candidate])).values()];
  const acceptedDecisionCount = allCands.filter((candidate) => ['accepted', 'in_progress', 'payment_pending', 'completed'].includes(candidate.status)).length;
  const decidedCount = allCands.filter((candidate) => candidate.status !== 'pending' && candidate.status !== 'cancelled').length;
  const misTitle = (mid: string) => mis.find((m) => m.id === mid)?.title ?? '—';
  const candCount = (mid: string) => (cands.get(mid) ?? []).filter((c) => c.status === 'pending').length;
  const unreadTotal = [...unread.values()].reduce((s, v) => s + v, 0);

  // Candidature de reference pour le menu contextuel d'une mission : la plus
  // avancee (terminee > en cours > retenue > en attente), jamais refusee/annulee.
  function activeCandidateFor(missionId: string): CandWithMission | null {
    const list = (cands.get(missionId) ?? []).map((c) => ({ ...c, missionTitle: misTitle(missionId) }));
    const rank = (status: string) =>
      status === 'completed' || status === 'payment_pending' ? 4 : status === 'in_progress' ? 3 : status === 'accepted' ? 2 : status === 'pending' ? 1 : 0;
    return list.filter((c) => rank(c.status) > 0).sort((a, b) => rank(b.status) - rank(a.status))[0] ?? null;
  }

  // 'accepted' (candidat retenu, pointage de debut pas encore confirme) et
  // 'in_progress' (QR de debut deja scanne) sont distingues : le pointage
  // n'a de sens (icone QR, action "Voir le pointage") qu'a partir du moment
  // ou un candidat est retenu, jamais pour une mission sans candidat.
  function missionBucket(mission: Mission): MissionBucket {
    if (mission.status === 'cancelled') return 'cancelled';
    const candidate = activeCandidateFor(mission.id);
    if (candidate?.status === 'completed' || candidate?.status === 'payment_pending') return 'completed';
    if (candidate?.status === 'in_progress') return 'in_progress';
    if (candidate?.status === 'accepted') return 'accepted';
    return 'open';
  }
  // Accueil = tableau de bord opérationnel : uniquement les missions qui
  // demandent une action, regroupées par action attendue. Les missions
  // terminées / annulées quittent l'accueil (elles vivent dans l'Historique).
  const accueilSections: Array<{ key: string; label: string; hint: string; missions: Mission[] }> = [
    { key: 'candidatures', label: 'Candidatures à traiter', hint: 'Choisir un candidat', missions: mis.filter((m) => missionBucket(m) === 'open' && candCount(m.id) > 0) },
    { key: 'confirmees', label: 'Confirmées — à préparer', hint: 'Préparer la mission', missions: mis.filter((m) => missionBucket(m) === 'accepted') },
    { key: 'encours', label: 'En cours', hint: 'Suivre · scanner le QR', missions: mis.filter((m) => missionBucket(m) === 'in_progress') },
    { key: 'publiees', label: 'Publiées — en attente de candidats', hint: '', missions: mis.filter((m) => missionBucket(m) === 'open' && candCount(m.id) === 0) },
  ].filter((s) => s.missions.length > 0);
  const accueilEmpty = accueilSections.length === 0;
  // Mission active pour le code de secours : la première acceptée ou en cours.
  const pinMission = mis.find((m) => ['accepted', 'in_progress'].includes(missionBucket(m))) ?? null;
  // Badge de l'onglet "Missions" : doit correspondre exactement à ce qui y
  // est affiché (les 4 sections ci-dessus), jamais aux annulées/terminées
  // qui n'y apparaissent jamais (elles vivent dans l'Historique).
  const activeMissionsCount = mis.filter((m) => missionBucket(m) !== 'cancelled' && missionBucket(m) !== 'completed').length;

  const formFounder = founderAccess;
  const formSiretOk = isValidSiret(vf.siret);
  const canCreateStructure = vf.nom.trim().length >= 2 && (formFounder || formSiretOk);
  const structureVerified = isVerifiedStructure(structure);
  const canPublishMission = structureVerified && (founderAccess || Boolean(structure?.subscription_active));

  if (loading) {
    return <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: T.mu, fontSize: 12 }}>Chargement…</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT, padding: '24px 16px' }}>
      <div className="rsp-structure-shell" style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: T.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: '#fff', fontSize: 15 }}>U</div>
            <span style={{ fontWeight: 900, fontSize: 15, color: T.text }}>Espace structure</span>
          </div>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
            <ThemeToggle />
            {session && <NotificationBell profileId={session.user.id} onDataChanged={() => reload().catch(() => undefined)} />}
            {founderAccess && <button onClick={() => window.location.assign('/fondateur')} style={{ fontSize: 10, color: T.cyan, background: 'none', border: `1px solid ${T.cb}`, borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }}>Fondateur</button>}
            <button onClick={() => setDocKey('cgu')} style={{ fontSize: 10, color: T.mu, background: 'none', border: `1px solid ${T.cb}`, borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }}>? Aide</button>
            <button onClick={() => signOut()} style={{ fontSize: 10, color: T.mu, background: 'none', border: `1px solid ${T.cb}`, borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }}>Déconnexion</button>
          </div>
        </div>

        {toast && <div style={{ marginBottom: 10, background: T.card, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '7px 11px', fontSize: 11, color: T.sub }}>{toast}</div>}

        {!structure ? (
          <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 17 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 4 }}>Avant de publier, on identifie ta structure</div>
            <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5, marginBottom: 16 }}>Seules les structures identifiées (SIRET) peuvent publier des missions.</div>
            {formFounder && (
              <div style={{ fontSize: 10.5, color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 9, padding: '8px 10px', marginBottom: 12 }}>
                Accès fondateur détecté sur ce compte.
              </div>
            )}
            <Fld label="Nom de la structure">
              <input aria-label="Nom de la structure" value={vf.nom} onChange={(e) => setVf((x) => ({ ...x, nom: e.target.value }))} placeholder="Burger Nord" style={inp} />
            </Fld>
            <Fld label="SIRET">
              <input aria-label="SIRET" value={vf.siret} onChange={(e) => setVf((x) => ({ ...x, siret: formatSiret(e.target.value) }))} placeholder="123 456 789 00012" style={inp} />
              {normalizeSiret(vf.siret).length > 0 && (
                <div style={{ fontSize: 9.5, color: formSiretOk ? T.green : T.amber, marginTop: -7, marginBottom: 10 }}>
                  {formSiretOk ? '✓ SIRET vérifié automatiquement' : 'Le SIRET doit contenir 14 chiffres valides.'}
                </div>
              )}
            </Fld>
            <button onClick={createFromForm} disabled={!canCreateStructure} style={{ width: '100%', background: canCreateStructure ? '#fff' : T.row, color: canCreateStructure ? '#000' : T.mu, border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: canCreateStructure ? 'pointer' : 'not-allowed', marginTop: 4 }}>
              {canCreateStructure ? 'Enregistrer ma structure' : 'SIRET valide requis'}
            </button>
          </div>
        ) : (
          <>
            {/* Bandeau structure */}
            <div style={{ padding: '4px 2px 12px', marginBottom: 8, borderBottom: `1px solid ${T.cb}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'hsl(200 58% 46%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                  {structure.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.2, fontWeight: 800, color: T.text, overflowWrap: 'anywhere' }}>{structure.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                    {structure.is_ess && <span style={{ fontSize: 8, fontWeight: 700, color: T.green, background: T.greenBg, borderRadius: 8, padding: '1px 6px' }}>🤝 Association · ESS</span>}
                    <span style={{ fontSize: 8, fontWeight: 700, color: verificationBadge(structure).color, background: verificationBadge(structure).bg, borderRadius: 8, padding: '1px 6px' }}>{verificationBadge(structure).label}</span>
                  </div>
                </div>
              </div>
              <details style={{ marginTop: 8 }}>
                <summary style={{ color: T.mu, fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>Profil public</summary>
                <AboutEditor structure={structure} onSaved={(about) => setStructure((s) => (s ? { ...s, about } : s))} notif={notif} />
              </details>
            </div>

            {/* Structure de tableau de bord : barre laterale en desktop (CSS
                @1024px+), navigation basse fixe en mobile — meme composant. */}
            <div className="structure-dashboard">
              <aside className="structure-sidebar" aria-label="Navigation Structure">
                <div className="structure-sidebar-brand" aria-hidden="true">
                  <div style={{ color: T.green, fontSize: 10, fontWeight: 900, letterSpacing: 1.2 }}>ESPACE STRUCTURE</div>
                  <div style={{ color: T.text, fontSize: 17, fontWeight: 900, marginTop: 5 }}>Tableau de bord</div>
                </div>
                <nav
                  className="structure-navigation"
                  aria-label="Navigation de l'espace Structure"
                  style={{ width: '100%', maxWidth: 430, borderTop: `1px solid ${T.cb}`, padding: '8px 10px calc(10px + env(safe-area-inset-bottom))', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, background: T.bg, position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', boxShadow: '0 -10px 28px rgba(0,0,0,.16)', zIndex: 50 }}
                >
                  {(
                    [
                      ['missions', 'Missions', activeMissionsCount],
                      ['candidats', 'Candidats', pending.length + unreadTotal],
                      ['habitues', 'Habitués', habitues.length],
                      ['historique', 'Historique', 0],
                    ] as [Tab, string, number][]
                  ).map(([k, l, n]) => (
                    <button
                      key={k}
                      onClick={() => {
                        setTab(k);
                        if (k === 'candidats') setCandMis(null);
                      }}
                      style={{ position: 'relative', background: tab === k ? '#fff' : 'transparent', color: tab === k ? '#05060d' : T.mu, border: 'none', borderRadius: 12, minHeight: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 10.5, fontWeight: 800, cursor: 'pointer' }}
                    >
                      {l}
                      {n > 0 && (
                        <span style={{ position: 'absolute', top: 3, right: '14%', minWidth: 16, height: 16, borderRadius: 9, background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 2px ${T.bg}` }}>{n}</span>
                      )}
                    </button>
                  ))}
                </nav>
              </aside>

              <main className="structure-dashboard-content">
                {/* ── MISSIONS ── */}
                {tab === 'missions' && (
                  <div className="structure-missions-layout">
                    <div className="structure-missions-main" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {!structureVerified && (
                        <div style={{ background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 10, padding: '10px 12px', fontSize: 10.5, color: T.amber, lineHeight: 1.45 }}>
                          Vérification SIRET requise avant publication.
                        </div>
                      )}
                      {structureVerified && !founderAccess && !structure.subscription_active && (
                        <div style={{ background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 10, padding: '10px 12px', fontSize: 10.5, color: T.amber, lineHeight: 1.45 }}>
                          Abonnement requis : abonne ta structure pour publier des missions.
                        </div>
                      )}
                      <button onClick={() => { setDuplicateSeed(null); if (canPublishMission) setShowPub(true); }} disabled={!canPublishMission} style={{ width: '100%', background: canPublishMission ? '#fff' : T.row, color: canPublishMission ? '#000' : T.mu, border: 'none', borderRadius: 11, padding: '13px 0', fontSize: 13, fontWeight: 900, cursor: canPublishMission ? 'pointer' : 'not-allowed', marginBottom: 2 }}>
                        {!structureVerified ? 'Structure à vérifier' : !canPublishMission ? 'Abonnement requis' : '＋ Publier une mission'}
                      </button>
                      {accueilEmpty && (
                        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 20, textAlign: 'center', fontSize: 11, color: T.mu, lineHeight: 1.5 }}>
                          Rien ne demande ton attention. Les missions terminées sont dans l'Historique.
                        </div>
                      )}

                      {/* Missions groupées par action attendue : chaque section
                          ne s'affiche que si elle contient des missions. */}
                      {accueilSections.map((section) => (
                        <div key={section.key} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ color: T.text, fontSize: 12.5, fontWeight: 900 }}>{section.label}</span>
                            {section.hint && <span style={{ color: T.mu, fontSize: 9.5, fontWeight: 700 }}>{section.hint}</span>}
                          </div>
                          <div className="structure-mission-grid" style={{ display: 'grid', gap: 8 }}>
                            {section.missions.map((m) => (
                              <MissionCard
                                key={m.id}
                                mission={m}
                                bucket={missionBucket(m)}
                                candidateCount={candCount(m.id)}
                                onOpenCandidates={() => { setCandMis(m.id); setTab('candidats'); }}
                                onOpenMenu={() => setManage({ mission: m, mode: 'menu' })}
                                onScan={() => setScanMission(m)}
                              />
                            ))}
                          </div>
                        </div>
                      ))}

                      {/* Performances (compactes) + code de secours discret. */}
                      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <StructurePerformances structureId={structure.id} favoris={habitues.length} avisADonner={ratingRequests.length} />
                        <button
                          type="button"
                          onClick={() => {
                            if (pinMission) setValidationMissionId(pinMission.id);
                            else notif('Le code de secours est disponible pendant une mission confirmée ou en cours.');
                          }}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', background: T.row, border: `1px solid ${T.cb}`, borderRadius: 11, padding: '11px 13px', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <span>
                            <span style={{ display: 'block', fontSize: 11.5, fontWeight: 800, color: T.text }}>Pointage manuel</span>
                            <span style={{ display: 'block', fontSize: 9.5, color: T.mu, marginTop: 2 }}>Le QR ne fonctionne pas ? Obtiens un code de secours.</span>
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 800, color: T.cyan, flexShrink: 0 }}>Code →</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── CANDIDATS ── */}
                {tab === 'candidats' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {candMis ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#22d3ee12', border: '1px solid #0e7490', borderRadius: 10, padding: '9px 12px' }}>
                        <span style={{ fontSize: 11, color: T.cyan, fontWeight: 800 }}>Candidats pour « {misTitle(candMis)} »</span>
                        <button onClick={() => setCandMis(null)} style={{ fontSize: 10, color: T.sub, background: T.row, border: `1px solid ${T.cb}`, borderRadius: 7, padding: '3px 9px', fontWeight: 700, cursor: 'pointer' }}>
                          Tous ✕
                        </button>
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: T.sub, lineHeight: 1.5, marginBottom: 2 }}>
                        Tape un candidat pour voir son CV vivant, puis confirme ou refuse. Une fois accepté, échange avec lui par message.
                      </div>
                    )}
                    {shownCands.map((c) => {
                  const delay = delays.get(c.id);
                  const unreadCount = unread.get(c.id) ?? 0;
                  return (
                    <div key={c.id} style={{ background: T.card, border: `1px solid ${c.status === 'accepted' ? T.greenBorder : c.status === 'rejected' ? T.redBorder : T.cb}`, borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ padding: '12px 14px', display: 'flex', gap: 11, alignItems: 'center', cursor: 'pointer' }} onClick={() => openPanel(c)}>
                        <div style={{ width: 38, height: 38, borderRadius: 11, background: 'hsl(24 58% 46%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15, flexShrink: 0 }}>
                          {(c.profile?.full_name || 'C').charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{c.profile?.full_name || 'Candidat'}</span>
                            {delay && c.status === 'accepted' && <span style={{ fontSize: 8, fontWeight: 700, color: T.amber, background: T.amberBg, borderRadius: 8, padding: '1px 6px' }}>⏱ retard {delay} min signalé</span>}
                          </div>
                          <div style={{ fontSize: 10, color: T.mu, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{misTitle(c.mission_id)}</div>
                        </div>
                        {c.status !== 'pending' && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: c.status === 'accepted' || c.status === 'in_progress' ? T.green : c.status === 'completed' || c.status === 'payment_pending' ? T.cyan : T.red, flexShrink: 0 }}>
                            {c.status === 'accepted'
                              ? 'accepté'
                              : c.status === 'in_progress'
                                ? 'en cours'
                                : c.status === 'payment_pending'
                                  ? 'paiement J+3'
                                  : c.status === 'completed'
                                    ? 'terminée'
                                    : c.status === 'rejected'
                                      ? 'refusé'
                                      : c.status === 'cancelled'
                                        ? 'annulée'
                                        : c.status}
                          </span>
                        )}
                      </div>
                      {c.status === 'pending' && (
                        <div style={{ padding: '0 14px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          {isStripeConfigured && isPaidMission(missionFor(c)) ? (
                            <button onClick={() => payAndConfirm(c)} disabled={payingId === c.id} style={{ background: '#fff', color: '#000', border: 'none', borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 900, cursor: payingId === c.id ? 'wait' : 'pointer' }}>
                              {payingId === c.id ? 'Redirection…' : '💳 Payer et confirmer'}
                            </button>
                          ) : (
                            <button onClick={() => decide(c.id, 'accepted')} style={{ background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}`, borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                              ✓ Accepter
                            </button>
                          )}
                          <button onClick={() => decide(c.id, 'rejected')} style={{ background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            Refuser
                          </button>
                        </div>
                      )}
                      {['accepted', 'in_progress', 'payment_pending', 'completed'].includes(c.status) && (
                        <div style={{ padding: '0 14px 12px', display: 'grid', gridTemplateColumns: c.conversation_status === 'open' && c.attendance_status === 'end_confirmed' && !ratedIds.has(c.id) ? '1fr 1fr' : '1fr', gap: 6 }}>
                          {c.conversation_status === 'open' && (
                            <button onClick={() => setChatFor(c)} style={{ position: 'relative', background: '#1d4ed815', color: '#93c5fd', border: '1px solid #1e40af', borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                              💬 Message
                              {unreadCount > 0 && (
                                <span style={{ position: 'absolute', top: -6, right: -4, minWidth: 15, height: 15, borderRadius: 8, background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                                  {unreadCount}
                                </span>
                              )}
                            </button>
                          )}
                          {c.attendance_status === 'end_confirmed' && !ratedIds.has(c.id) && (
                            <button onClick={() => setRatingCand(c)} style={{ background: '#22d3ee15', color: T.cyan, border: '1px solid #0e7490', borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                              ★ Noter
                            </button>
                          )}
                          {c.status === 'accepted' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                              <button onClick={() => validationDistance(c, 'start')} style={{ background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}`, borderRadius: 8, padding: '9px 0', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                                Début à distance
                              </button>
                              <button onClick={() => signalerAbsence(c)} style={{ background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: '9px 0', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                                Signaler absence
                              </button>
                            </div>
                          )}
                          {c.status === 'in_progress' && (
                            <button onClick={() => validationDistance(c, 'end')} style={{ background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}`, borderRadius: 8, padding: '9px 0', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                              Fin à distance
                            </button>
                          )}
                          {c.cv_status === 'pending_verification' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                              <button onClick={() => validerMissionCv(c)} style={{ background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}`, borderRadius: 8, padding: '9px 0', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                                ✓ Valider la mission
                              </button>
                              <button onClick={() => contesterMissionCv(c)} style={{ background: T.amberBg, color: T.amber, border: `1px solid ${T.amberBorder}`, borderRadius: 8, padding: '9px 0', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                                Contester
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {shownCands.length === 0 && (
                  <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 20, textAlign: 'center', fontSize: 11, color: T.mu }}>
                    {candMis ? "Personne n'a encore postulé à cette mission." : "Aucun candidat pour l'instant."}
                  </div>
                )}
              </div>
            )}

            {/* ── HABITUÉS ── */}
                {tab === 'habitues' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 10, color: T.sub, lineHeight: 1.5, marginBottom: 2 }}>
                      Les travailleurs qui ont déjà terminé au moins une mission chez toi.
                    </div>
                    {habitues.length === 0 && (
                      <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 20, textAlign: 'center', fontSize: 11, color: T.mu }}>
                        Les travailleurs qui terminent des missions chez toi apparaîtront ici.
                      </div>
                    )}
                    {habitues.map((h) => (
                      <div key={h.workerId} style={{ display: 'flex', gap: 10, alignItems: 'center', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '10px 12px' }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'hsl(265 58% 46%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                          {h.nom.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: T.text }}>{h.nom}</div>
                        <span style={{ fontSize: 14, fontWeight: 900, color: T.amber }}>{h.fois}×</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── HISTORIQUE : compact, avis anonymisés + stats détaillées repliables ── */}
                {tab === 'historique' && (
                  <div className="rsp-grid-lg" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <section style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '13px 15px' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Performance réelle</div>
                      <StructureStatsSummary structureId={structure.id} acceptedCount={acceptedDecisionCount} decidedCount={decidedCount} />
                    </section>
                    <StructureHistoryPanel structureId={structure.id} />
                    <button
                      type="button"
                      onClick={() => setShowDetailedStats((v) => !v)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '11px 14px', fontSize: 11.5, fontWeight: 800, color: T.text, cursor: 'pointer' }}
                    >
                      <span>Statistiques détaillées &amp; portefeuille</span>
                      <span style={{ color: T.mu }}>{showDetailedStats ? '▲' : '▼'}</span>
                    </button>
                    {showDetailedStats && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <StatsPanel structureId={structure.id} />
                        {session && <WalletCard profileId={session.user.id} mode="structure" />}
                      </div>
                    )}
                    <AideRegles onOpen={setDocKey} />
                  </div>
                )}
              </main>
            </div>

            {/* Panneau candidat */}
            {panelC && (
              <div className="rsp-sheet urosi-modal-layer urosi-bottom-sheet-layer" role="dialog" aria-modal="true" aria-label="Profil du candidat" style={{ background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setPanelC(null)}>
                <div className="rsp-sheet-body urosi-bottom-sheet" style={{ width: '100%', maxWidth: 420, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 26px', fontFamily: FONT }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 11, alignItems: 'center', marginBottom: 13 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'hsl(24 58% 46%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 17, flexShrink: 0 }}>
                      {(panelC.profile?.full_name || 'C').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: T.text }}>{panelC.profile?.full_name || 'Candidat'}</div>
                      <div style={{ fontSize: 10, color: T.mu, marginTop: 2 }}>candidat sur « {misTitle(panelC.mission_id)} »</div>
                    </div>
                    <button onClick={() => setPanelC(null)} style={{ background: T.row, border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', color: T.sub, fontSize: 13 }}>×</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 13 }}>
                    {[
                      ['Note reçue', panelRep ? (panelRep.average ? `★ ${panelRep.average.toFixed(1).replace('.', ',')}` : '—') : '…'],
                      ['Avis reçus', panelRep ? String(panelRep.count) : '…'],
                      ['Chez toi', `${(completedByWorker.get(panelC.worker_id) ?? []).length}×`],
                    ].map(([l, v]) => (
                      <div key={l} style={{ background: T.row, borderRadius: 8, padding: '9px 6px', textAlign: 'center' }}>
                        <div style={{ fontSize: 14, fontWeight: 900, color: T.text }}>{v}</div>
                        <div style={{ fontSize: 8, color: T.mu, marginTop: 1 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 9.5, color: T.mu, lineHeight: 1.5, marginBottom: 12 }}>
                    Notes données par les structures après mission terminée. Informatives et jamais bloquantes (CGU) : la décision t'appartient.
                  </div>
                  {panelC.status === 'pending' && (() => {
                    const mission = missionFor(panelC);
                    const paid = isStripeConfigured && isPaidMission(mission);
                    const workerCents = mission?.worker_rate_cents ?? 0;
                    const commissionCents = Math.round(workerCents * SERVICE_FEE_RATE);
                    const totalCents = workerCents + commissionCents;
                    return (
                      <>
                        {paid && mission && (
                          <div style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '12px 13px', marginBottom: 10 }}>
                            <div style={{ fontSize: 10, color: T.mu, marginBottom: 8 }}>
                              {mission.title}{mission.scheduled_date ? ` · ${formatLongDay(mission.scheduled_date)}` : ''}{mission.duration_minutes ? ` · ${formatHours(mission.duration_minutes)}` : ''}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 5 }}>
                              <span style={{ color: T.mu }}>Rémunération du travailleur</span><strong style={{ color: T.text }}>{formatMoney(workerCents)}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 5 }}>
                              <span style={{ color: T.mu }}>Commission UROSI</span><strong style={{ color: T.text }}>{formatMoney(commissionCents)}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 900, paddingTop: 6, borderTop: `1px solid ${T.cb}` }}>
                              <span style={{ color: T.text }}>Total débité</span><span style={{ color: T.text }}>{formatMoney(totalCents)}</span>
                            </div>
                            <div style={{ fontSize: 9, color: T.mu, marginTop: 7, lineHeight: 1.45 }}>
                              La mission n'est confirmée qu'après paiement. Tu seras redirigé vers un paiement sécurisé Stripe.
                            </div>
                          </div>
                        )}
                        {paid ? (
                          <>
                            <button onClick={() => payAndConfirm(panelC)} disabled={payingId === panelC.id} style={{ width: '100%', background: '#fff', color: '#000', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: payingId === panelC.id ? 'wait' : 'pointer', marginBottom: 6 }}>
                              {payingId === panelC.id ? 'Redirection vers le paiement…' : `Payer et confirmer la mission · ${formatMoney(totalCents)}`}
                            </button>
                            <button onClick={() => decide(panelC.id, 'rejected')} style={{ width: '100%', background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 10, padding: '11px 0', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                              Refuser le candidat
                            </button>
                          </>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                            <button onClick={() => decide(panelC.id, 'accepted')} style={{ background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}`, borderRadius: 8, padding: '11px 0', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                              ✓ Accepter
                            </button>
                            <button onClick={() => decide(panelC.id, 'rejected')} style={{ background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: '11px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                              Refuser
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Notation du travailleur */}
            {ratingCand && (
              <div className="rsp-sheet urosi-modal-layer urosi-bottom-sheet-layer" role="dialog" aria-modal="true" aria-label="Mission terminée" style={{ background: 'rgba(0,0,0,.92)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => closeRatingModal(true)}>
                <div className="rsp-sheet-body urosi-bottom-sheet" style={{ width: '100%', maxWidth: 420, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 26px', fontFamily: FONT }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: T.text, marginBottom: 3 }}>Mission terminée</div>
                  <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5, marginBottom: 12 }}>
                    Comment s'est passée votre expérience avec {ratingCand.profile?.full_name || 'ce travailleur'} ? Ta note apparaîtra dans son CV vivant une fois publiée (informative, jamais bloquante).
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => noterTravailleur(n)} style={{ flex: 1, padding: '12px 0', fontSize: 22, background: T.row, border: `1px solid ${T.cb}`, borderRadius: 10, cursor: 'pointer', color: '#f59e0b' }}>
                        ★
                      </button>
                    ))}
                  </div>
                  <button onClick={() => closeRatingModal(true)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.mu, padding: '4px 0' }}>
                    Me le rappeler plus tard
                  </button>
                </div>
              </div>
            )}

            {/* Chat avec un candidat accepté */}
            {chatFor && session && (
              <ChatSheet
                applicationId={chatFor.id}
                myId={session.user.id}
                title={`${chatFor.profile?.full_name || 'Candidat'} — ${chatFor.missionTitle}`}
                onClose={() => {
                  setChatFor(null);
                  loadMissionData(mis).catch(() => undefined);
                }}
              />
            )}

            {/* Publier (modal) */}
            {showPub && structure && (
              <PublishModal
                structure={structure}
                initial={duplicateSeed}
                founderAccess={founderAccess}
                onClose={() => { setShowPub(false); setDuplicateSeed(null); }}
                onPublished={(m) => {
                  setMis((l) => [m, ...l]);
                  setShowPub(false);
                  setDuplicateSeed(null);
                  setTab('missions');
                  notif(`« ${m.title} » publiée${m.pricing_breakdown && m.pricing_breakdown.adjustments.length > 0 ? ` à ${euros(m.worker_rate_cents)} (rémunération boostée)` : ''}.`);
                }}
              />
            )}
            {validationMissionId && structure && (
              <MissionValidationPanel missionId={validationMissionId} structureId={structure.id} onClose={() => setValidationMissionId(null)} />
            )}
            {manage && (
              <MissionManageSheet
                mission={manage.mission}
                mode={manage.mode}
                bucket={missionBucket(manage.mission)}
                candidate={activeCandidateFor(manage.mission.id)}
                candidateCount={candCount(manage.mission.id)}
                replacementCandidates={(cands.get(manage.mission.id) ?? [])
                  .filter((c) => c.status === 'pending')
                  .map((c) => ({ ...c, missionTitle: manage.mission.title }))}
                givenScore={(() => {
                  const c = activeCandidateFor(manage.mission.id);
                  return c ? givenRatings.get(c.id) : undefined;
                })()}
                onClose={() => setManage(null)}
                onModeChange={(mode) => setManage((m) => (m ? { ...m, mode } : m))}
                onSaveEdit={(patch) => saveMissionEdit(manage.mission.id, patch)}
                onCancelMission={() => confirmCancelMission(manage.mission)}
                onDuplicate={() => startDuplicate(manage.mission)}
                onOpenCandidate={() => {
                  const c = activeCandidateFor(manage.mission.id);
                  if (c) {
                    setManage(null);
                    openPanel(c);
                  }
                }}
                onOpenCandidates={() => {
                  setCandMis(manage.mission.id);
                  setManage(null);
                  setTab('candidats');
                }}
                onMessage={() => {
                  const c = activeCandidateFor(manage.mission.id);
                  if (c) {
                    setManage(null);
                    setChatFor(c);
                  }
                }}
                onReportIssue={() => {
                  const c = activeCandidateFor(manage.mission.id);
                  if (c) signalerProbleme(c.id);
                }}
                onReplaceWith={(newApplicationId) => {
                  const c = activeCandidateFor(manage.mission.id);
                  if (c) confirmReplace(c.id, newApplicationId);
                }}
                onNotifyNearby={() => notifyNearbyForReplacement(manage.mission.id)}
              />
            )}
            {scanMission && (
              <StructureQrScanSheet
                expectedMissionId={scanMission.id}
                expectedMissionTitle={scanMission.title}
                onClose={() => setScanMission(null)}
                onConfirmed={() => reload().catch(() => undefined)}
                onUsePin={() => {
                  const missionId = scanMission.id;
                  setScanMission(null);
                  setValidationMissionId(missionId);
                }}
              />
            )}
          </>
        )}

        {docKey && <DocModal dk={docKey} onClose={() => setDocKey(null)} />}
      </div>
    </div>
  );
}

function AboutEditor({ structure, onSaved, notif }: { structure: Structure; onSaved: (about: string) => void; notif: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(structure.about ?? '');

  if (!editing) {
    return (
      <div style={{ marginTop: 8 }}>
        {structure.about ? <div style={{ fontSize: 10.5, color: T.sub, lineHeight: 1.5 }}>{structure.about}</div> : null}
        <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: T.cyan, fontWeight: 700, padding: '4px 0 0' }}>
          {structure.about ? 'Modifier le "À propos"' : '＋ Ajouter un "À propos" (visible par les travailleurs)'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Présente ta structure en quelques mots…"
        style={{ ...inp, resize: 'none', lineHeight: 1.5, marginBottom: 6 }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={async () => {
            try {
              await updateStructureAbout(structure.id, text.trim());
              onSaved(text.trim());
              setEditing(false);
              notif('"À propos" enregistré.');
            } catch (e) {
              notif(describeError(e, "l'enregistrement"));
            }
          }}
          style={{ flex: 1, background: '#fff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
        >
          Enregistrer
        </button>
        <button onClick={() => setEditing(false)} style={{ flex: 1, background: T.row, color: T.sub, border: 'none', borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

// Menu contextuel a trois points d'une mission : la liste d'actions depend
// uniquement du bucket (statut de la candidature la plus avancee), jamais
// d'un bouton "Contacter" laisse visible par erreur apres la fin de mission.
function MissionManageSheet({
  mission,
  mode,
  bucket,
  candidate,
  candidateCount,
  replacementCandidates,
  givenScore,
  onClose,
  onModeChange,
  onSaveEdit,
  onCancelMission,
  onDuplicate,
  onOpenCandidate,
  onOpenCandidates,
  onMessage,
  onReportIssue,
  onReplaceWith,
  onNotifyNearby,
}: {
  mission: Mission;
  mode: ManageMode;
  bucket: MissionBucket;
  candidate: CandWithMission | null;
  candidateCount: number;
  replacementCandidates: CandWithMission[];
  givenScore: number | undefined;
  onClose: () => void;
  onModeChange: (m: ManageMode) => void;
  onSaveEdit: (patch: MissionNonSensitivePatch) => void;
  onCancelMission: () => void;
  onDuplicate: () => void;
  onOpenCandidate: () => void;
  onOpenCandidates: () => void;
  onMessage: () => void;
  onReportIssue: () => void;
  onReplaceWith: (newApplicationId: string) => void;
  onNotifyNearby: () => void;
}) {
  const [edit, setEdit] = useState({
    title: mission.title,
    detail: mission.detail ?? '',
    dressCode: mission.dress_code ?? '',
    equipment: mission.equipment ?? '',
    instructions: mission.instructions ?? '',
  });

  return (
    <div className="rsp-sheet urosi-modal-layer urosi-bottom-sheet-layer" role="dialog" aria-modal="true" aria-label="Gérer la mission" style={{ background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div className="rsp-sheet-body urosi-bottom-sheet" style={{ width: '100%', maxWidth: 420, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 26px', fontFamily: FONT }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 14, fontWeight: 900, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 10 }}>{mission.title}</span>
          <button onClick={onClose} style={{ background: T.row, border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', color: T.sub, fontSize: 14, flexShrink: 0 }}>×</button>
        </div>

        {mode === 'menu' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {bucket === 'open' && (
              <>
                <SheetAction label="Voir les détails" onClick={() => onModeChange('summary')} />
                {candidateCount > 0 && <SheetAction label={`Voir les candidats (${candidateCount})`} onClick={onOpenCandidates} />}
                <SheetAction label="Modifier la mission" onClick={() => onModeChange('edit')} />
                <SheetAction label="Dupliquer la mission" onClick={onDuplicate} />
                <SheetAction label="Annuler la mission" danger onClick={() => onModeChange('cancel')} />
              </>
            )}
            {bucket === 'accepted' && (
              <>
                <SheetAction label="Voir le travailleur" onClick={onOpenCandidate} />
                {candidate?.conversation_status === 'open' && <SheetAction label="Messagerie" onClick={onMessage} />}
                {candidate?.stripe_payment_status === 'paid' && <SheetAction label="Remplacer le travailleur" onClick={() => onModeChange('replace')} />}
                <SheetAction label="Modifier les informations non sensibles" onClick={() => onModeChange('edit')} />
                <SheetAction label="Dupliquer la mission" onClick={onDuplicate} />
                <SheetAction label="Annuler selon les règles" danger onClick={() => onModeChange('cancel')} />
              </>
            )}
            {bucket === 'in_progress' && (
              <>
                <SheetAction label="Voir le pointage" onClick={onOpenCandidate} />
                {candidate?.conversation_status === 'open' && <SheetAction label="Messagerie" onClick={onMessage} />}
                <SheetAction label="Signaler un problème" onClick={onReportIssue} />
              </>
            )}
            {bucket === 'completed' && (
              <>
                <SheetAction label="Voir le résumé" onClick={() => onModeChange('summary')} />
                <SheetAction label="Voir le paiement" onClick={() => onModeChange('summary')} />
                <SheetAction label={givenScore ? `Avis donné : ${'★'.repeat(givenScore)}` : 'Voir les avis'} onClick={() => onModeChange('summary')} />
              </>
            )}
            {bucket === 'cancelled' && <SheetAction label="Voir le résumé" onClick={() => onModeChange('summary')} />}
          </div>
        )}

        {mode === 'edit' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Fld label="Intitulé">
              <input aria-label="Intitulé" value={edit.title} onChange={(e) => setEdit((x) => ({ ...x, title: e.target.value }))} style={inp} />
            </Fld>
            <Fld label="Descriptif">
              <textarea aria-label="Descriptif" value={edit.detail} onChange={(e) => setEdit((x) => ({ ...x, detail: e.target.value }))} rows={3} style={{ ...inp, resize: 'none', lineHeight: 1.5 }} />
            </Fld>
            <Fld label="Tenue demandée">
              <input aria-label="Tenue demandée" value={edit.dressCode} onChange={(e) => setEdit((x) => ({ ...x, dressCode: e.target.value }))} style={inp} />
            </Fld>
            <Fld label="Équipement">
              <input aria-label="Équipement" value={edit.equipment} onChange={(e) => setEdit((x) => ({ ...x, equipment: e.target.value }))} style={inp} />
            </Fld>
            <Fld label="Consignes">
              <textarea aria-label="Consignes" value={edit.instructions} onChange={(e) => setEdit((x) => ({ ...x, instructions: e.target.value }))} rows={3} style={{ ...inp, resize: 'none', lineHeight: 1.5 }} />
            </Fld>
            <div style={{ fontSize: 9.5, color: T.mu, lineHeight: 1.5 }}>Le prix, les horaires et le nombre de places restent fixés une fois la mission publiée.</div>
            <button
              onClick={() =>
                onSaveEdit({
                  title: edit.title.trim(),
                  detail: edit.detail.trim() || null,
                  dress_code: edit.dressCode.trim() || null,
                  equipment: edit.equipment.trim() || null,
                  instructions: edit.instructions.trim() || null,
                })
              }
              style={{ width: '100%', background: '#fff', color: '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer' }}
            >
              Enregistrer
            </button>
          </div>
        )}

        {mode === 'cancel' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.5 }}>
              Annuler cette mission {candidate ? 'préviendra le travailleur concerné et libérera sa candidature' : "n'a pas de candidat engagé pour l'instant"}. Cette action est définitive.
            </div>
            {candidate?.stripe_payment_status === 'paid' && (
              <div style={{ fontSize: 10.5, color: T.amber, background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 10, padding: '9px 11px', lineHeight: 1.45 }}>
                Cette mission est payée : un remboursement Stripe sera lancé automatiquement et le Wallet sera synchronisé.
              </div>
            )}
            <button onClick={onCancelMission} style={{ width: '100%', background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 10, padding: '12px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer' }}>
              {candidate?.stripe_payment_status === 'paid' ? 'Annuler et rembourser' : "Confirmer l'annulation"}
            </button>
            <button onClick={() => onModeChange('menu')} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.mu, padding: '4px 0' }}>
              Retour
            </button>
          </div>
        )}

        {mode === 'replace' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.5 }}>
              Choisis un remplaçant parmi les candidats de la mission. Le paiement déjà réglé est transféré au remplaçant — aucun nouveau paiement, aucun remboursement.
            </div>
            {replacementCandidates.length === 0 ? (
              <div style={{ fontSize: 10.5, color: T.mu, background: T.row, borderRadius: 10, padding: '11px 12px', lineHeight: 1.45 }}>
                Aucun autre candidat en attente pour l'instant. La mission reste ouverte aux candidatures — tu peux prévenir des travailleurs proches.
              </div>
            ) : (
              replacementCandidates.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: T.row, borderRadius: 10, padding: '10px 12px' }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.profile?.full_name || 'Candidat'}</span>
                  <button onClick={() => candidate && onReplaceWith(c.id)} style={{ background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}`, borderRadius: 8, padding: '7px 12px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
                    Choisir
                  </button>
                </div>
              ))
            )}
            <button onClick={onNotifyNearby} style={{ width: '100%', background: 'none', border: `1px solid ${T.cb}`, color: T.cyan, borderRadius: 10, padding: '10px 0', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
              Prévenir des travailleurs proches
            </button>
            <button onClick={() => onModeChange('menu')} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.mu, padding: '4px 0' }}>
              Retour
            </button>
          </div>
        )}

        {mode === 'summary' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5 }}>{mission.detail || 'Aucun descriptif.'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: T.row, borderRadius: 8, padding: '9px 10px' }}>
                <div style={{ fontSize: 8.5, color: T.mu }}>Rémunération</div>
                <div style={{ fontSize: 13, fontWeight: 900, color: T.text }}>{mission.is_solidaire ? 'Solidaire' : euros(mission.worker_rate_cents)}</div>
              </div>
              <div style={{ background: T.row, borderRadius: 8, padding: '9px 10px' }}>
                <div style={{ fontSize: 8.5, color: T.mu }}>Places</div>
                <div style={{ fontSize: 13, fontWeight: 900, color: T.text }}>{mission.positions ?? mission.places}</div>
              </div>
            </div>
            {bucket === 'completed' && givenScore != null && (
              <div style={{ background: T.row, borderRadius: 8, padding: '9px 10px' }}>
                <div style={{ fontSize: 8.5, color: T.mu }}>Note que tu as donnée</div>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#f59e0b' }}>{'★'.repeat(givenScore)}</div>
              </div>
            )}
            {bucket === 'completed' && (
              <button
                onClick={onReportIssue}
                style={{ width: '100%', textAlign: 'left', background: T.amberBg, color: T.amber, border: `1px solid ${T.amberBorder}`, borderRadius: 10, padding: '11px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
              >
                Signaler un problème
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SheetAction({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{ width: '100%', textAlign: 'left', background: danger ? T.redBg : T.row, color: danger ? T.red : T.text, border: `1px solid ${danger ? T.redBorder : T.cb}`, borderRadius: 10, padding: '12px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
    >
      {label}
    </button>
  );
}

function PublishModal({ structure, initial, founderAccess, onClose, onPublished }: { structure: Structure; initial?: Mission | null; founderAccess?: boolean; onClose: () => void; onPublished: (m: Mission) => void }) {
  const [f, setF] = useState(() => ({
    t: initial ? `${initial.title} (copie)` : '',
    city: initial?.city ?? '',
    address: initial?.address ?? '',
    category: initial?.mission_category ?? 'renfort_service',
    rateMode: (initial && !initial.hourly_rate ? 'fixed' : 'hourly') as RateMode,
    hourly: initial?.hourly_rate ? String(initial.hourly_rate) : String(DEFAULT_HOURLY_EUR),
    fixed: initial && !initial.hourly_rate ? String((initial.worker_rate_cents ?? 6000) / 100) : '60',
    desc: initial?.detail ?? '',
    dressCode: initial?.dress_code ?? '',
    equipment: initial?.equipment ?? '',
    instructions: initial?.instructions ?? '',
    positions: initial?.positions ?? 1,
    solid: initial?.is_solidaire ?? false,
  }));
  // Duplique la structure des creneaux (nombre de jours, heures) mais jamais
  // les dates : reprend a partir de demain, jamais dans le passe.
  const [slots, setSlots] = useState<MissionSlot[]>(() => {
    if (!initial?.slots || initial.slots.length === 0) return [{ date: todayPlus(1), start: '18:00', end: '23:00' }];
    const sorted = initial.slots.slice().sort((a, b) => a.date.localeCompare(b.date));
    const base = todayPlus(1);
    const firstDate = sorted[0]?.date ?? base;
    return sorted.map((sl) => {
      const offsetDays = Math.round((new Date(`${sl.date}T00:00:00`).getTime() - new Date(`${firstDate}T00:00:00`).getTime()) / 86_400_000);
      return { ...sl, date: addDays(base, offsetDays) };
    });
  });
  const [showDetail, setShowDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minutes = totalMinutes(slots);
  const durationHoursPerPerson = minutes / 60;
  const missionDays = distinctDays(slots).length;
  const maxDaysReached = missionDays >= 3;
  const daySpan = spanDays(slots);
  const positions = Math.max(1, Math.floor(f.positions || 1));
  const totalWorkerHours = durationHoursPerPerson * positions;
  const hourlyValue = Number(f.hourly.replace(',', '.'));
  const fixedValue = Number(f.fixed.replace(',', '.'));
  const safeHourlyValue = Number.isFinite(hourlyValue) ? hourlyValue : 0;
  const safeFixedValue = Number.isFinite(fixedValue) ? fixedValue : 0;
  const invalidSlots = slots.some((sl) => !sl.date || !sl.start || !sl.end || sl.start === sl.end || slotMinutes(sl) <= 0);
  const tooLong = minutes > MAX_MISSION_MINUTES || daySpan > 3;
  const rateInvalid = !f.solid && (f.rateMode === 'hourly' ? !Number.isFinite(hourlyValue) || hourlyValue < MIN_HOURLY_EUR || hourlyValue > MAX_HOURLY_EUR : !Number.isFinite(fixedValue) || fixedValue <= 0);
  const workerAmountCents = f.solid ? 0 : f.rateMode === 'hourly' ? Math.round(safeHourlyValue * 100 * durationHoursPerPerson) : Math.round(safeFixedValue * 100);
  const workerSubtotalCents = workerAmountCents * positions;
  const serviceFeeCents = f.solid ? 0 : Math.round(workerSubtotalCents * SERVICE_FEE_RATE);
  const structureTotalCents = workerSubtotalCents + serviceFeeCents;
  const first = firstSlot(slots);
  const last = lastSlot(slots);
  const summary = first
    ? `${formatLongDay(first.date)} · ${first.start}–${last?.end ?? first.end}${last && last.end < last.start ? ' +1' : ''} · ${formatHours(minutes)}`
    : '';
  const subscriptionOk = Boolean(founderAccess) || structure.subscription_active;
  const validationMessage =
    !subscriptionOk
      ? "Abonnement requis : abonne ta structure pour publier des missions."
      : f.t.trim().length < 2
      ? 'Renseigne le titre de la mission.'
      : f.city.trim().length < 2
        ? 'Renseigne la ville de la mission.'
        : f.address.trim().length < 4
          ? "Renseigne l'adresse complète de la mission."
        : slots.length === 0 || slots.some((sl) => !sl.date)
          ? 'Choisis au moins une date.'
          : invalidSlots
            ? "Chaque jour doit avoir une heure de début et une heure de fin cohérentes."
            : minutes <= 0
              ? 'La durée doit être supérieure à zéro.'
              : positions < 1
                ? 'Le nombre de personnes doit être supérieur à zéro.'
                : tooLong
                  ? 'La mission dépasse la durée maximale autorisée par UROSI.'
                  : rateInvalid
                    ? 'Renseigne un tarif valide.'
                    : null;
  const ok = !validationMessage && !busy;

  function setSlot(i: number, patch: Partial<MissionSlot>) {
    setSlots((prev) => prev.map((sl, idx) => (idx === i ? { ...sl, ...patch } : sl)));
  }

  function addDay() {
    if (maxDaysReached) return;
    setSlots((prev) => {
      const lastSlotValue = prev[prev.length - 1] ?? { date: todayPlus(1), start: '18:00', end: '23:00' };
      return [...prev, { date: addDays(lastSlotValue.date, 1), start: lastSlotValue.start, end: lastSlotValue.end }];
    });
  }

  function duplicatePrevious(i: number) {
    const previous = slots[i - 1];
    if (!previous) return;
    setSlot(i, { start: previous.start, end: previous.end });
  }

  function applyShortcut(i: number, start: string, end: string) {
    setSlot(i, { start, end });
  }

  async function publish() {
    if (!ok) {
      setError(validationMessage);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const coords = geocodeMelCity(`${f.address}, ${f.city}`);
      const start = firstSlot(slots);
      const end = lastSlot(slots);
      const startAt = start ? slotStartsAt(start) : dateTime(todayPlus(1), '09:00');
      const endAt = end ? slotEndsAt(end) : dateTime(todayPlus(1), '10:00');
      const mission = await createMission({
        structure_id: structure.id,
        title: f.t.trim(),
        detail: f.desc.trim() || null,
        city: f.city.trim(),
        address: f.address.trim(),
        location: f.address.trim(),
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        scheduled_date: start?.date ?? todayPlus(1),
        start_time: start?.start ?? null,
        end_time: end?.end ?? null,
        starts_at: startAt.toISOString(),
        ends_at: endAt.toISOString(),
        duration_minutes: minutes,
        duration_minutes_per_person: minutes,
        mission_days: missionDays,
        slots,
        places: positions,
        positions,
        worker_rate_cents: workerAmountCents,
        base_rate_cents: f.solid ? null : workerAmountCents,
        hourly_rate: f.solid || f.rateMode !== 'hourly' ? null : safeHourlyValue,
        worker_amount: workerAmountCents / 100,
        worker_subtotal: workerSubtotalCents / 100,
        service_fee: serviceFeeCents / 100,
        structure_total: structureTotalCents / 100,
        total_worker_hours: Number(totalWorkerHours.toFixed(2)),
        time_slot: inferTimeSlot(slots),
        day_of_week: dayOfWeek(start?.date ?? todayPlus(1)),
        mission_category: f.category,
        dress_code: f.dressCode.trim() || null,
        equipment: f.equipment.trim() || null,
        instructions: f.instructions.trim() || null,
        is_solidaire: f.solid,
      });
      onPublished(mission);
    } catch (e) {
      setError(describeError(e, 'la publication de la mission'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rsp-sheet urosi-modal-layer urosi-bottom-sheet-layer" role="dialog" aria-modal="true" aria-label="Publier une mission" style={{ background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div className="rsp-sheet-body urosi-bottom-sheet" style={{ width: '100%', maxWidth: 420, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 26px', fontFamily: FONT }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: T.text }}>Nouvelle mission</span>
          <button onClick={onClose} style={{ background: T.row, border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', color: T.sub, fontSize: 14 }}>×</button>
        </div>

        <Fld label="Intitulé de la mission">
          <input aria-label="Intitulé" value={f.t} onChange={(e) => setF((x) => ({ ...x, t: e.target.value }))} placeholder="Renfort service, accueil, inventaire…" style={inp} autoFocus />
        </Fld>
        <Fld label="Catégorie">
          <select aria-label="Catégorie" value={f.category} onChange={(e) => setF((x) => ({ ...x, category: e.target.value }))} style={inp}>
            {MISSION_CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Fld>
        <Fld label="Ville">
          <input aria-label="Ville" value={f.city} onChange={(e) => setF((x) => ({ ...x, city: e.target.value }))} placeholder="Lille" style={inp} />
        </Fld>
        <Fld label="Adresse complète">
          <input aria-label="Adresse complète" value={f.address} onChange={(e) => setF((x) => ({ ...x, address: e.target.value }))} placeholder="12 rue Nationale, 59000 Lille" style={inp} />
        </Fld>

        <Fld label="Horaires">
          {slots.map((sl, i) => (
            <div key={`${sl.date}-${i}`} style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 10, marginBottom: 9 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <div style={{ color: T.text, fontSize: 12, fontWeight: 900 }}>Jour {i + 1}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {i > 0 && (
                    <button onClick={() => duplicatePrevious(i)} style={{ background: 'transparent', color: T.mu, border: `1px solid ${T.cb}`, borderRadius: 7, padding: '5px 7px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}>
                      Dupliquer
                    </button>
                  )}
                  {slots.length > 1 && (
                    <button onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Supprimer le jour" style={{ background: T.redBg, color: T.red, border: 'none', borderRadius: 7, width: 26, height: 26, cursor: 'pointer', fontSize: 12 }}>
                      ×
                    </button>
                  )}
                </div>
              </div>
              <input aria-label={`Date ${i + 1}`} type="date" value={sl.date} onChange={(e) => setSlot(i, { date: e.target.value })} style={{ ...inp, marginBottom: 8, padding: '10px 9px', fontSize: 12 }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 8 }}>
                {SLOT_SHORTCUTS.map((shortcut) => (
                  <button key={shortcut.label} onClick={() => applyShortcut(i, shortcut.start, shortcut.end)} style={{ background: T.card, color: T.sub, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '7px 0', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}>
                    {shortcut.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input aria-label={`Heure de début ${i + 1}`} type="time" value={sl.start} onChange={(e) => setSlot(i, { start: e.target.value })} style={{ ...inp, marginBottom: 0, padding: '10px 9px', fontSize: 12 }} />
                <input aria-label={`Heure de fin ${i + 1}`} type="time" value={sl.end} onChange={(e) => setSlot(i, { end: e.target.value })} style={{ ...inp, marginBottom: 0, padding: '10px 9px', fontSize: 12 }} />
              </div>
              <div style={{ color: sl.start === sl.end ? T.red : T.mu, fontSize: 10, marginTop: 7 }}>
                {sl.end < sl.start ? `Fin le ${formatLongDay(addDays(sl.date, 1))} · ${formatHours(slotMinutes(sl))}` : `${formatHours(slotMinutes(sl))}`}
              </div>
            </div>
          ))}
          <button disabled={maxDaysReached} onClick={addDay} style={{ background: 'none', border: `1px dashed ${T.cb}`, color: T.sub, borderRadius: 9, padding: '9px 0', width: '100%', fontSize: 11, fontWeight: 800, cursor: maxDaysReached ? 'not-allowed' : 'pointer', opacity: maxDaysReached ? 0.5 : 1 }}>
            ＋ Ajouter un jour
          </button>
          {maxDaysReached && <div style={{ color: T.amber, fontSize: 10.5, marginTop: 7 }}>Une mission dure 3 jours maximum.</div>}
        </Fld>

        <Fld label="Nombre de personnes">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setF((x) => ({ ...x, positions: Math.max(1, x.positions - 1) }))} style={{ width: 30, height: 30, borderRadius: '50%', background: T.row, border: `1px solid ${T.cb}`, color: T.text, fontSize: 15, cursor: 'pointer' }}>−</button>
            <span style={{ fontSize: 15, fontWeight: 900, color: T.text, minWidth: 95, textAlign: 'center' }}>{positions} personne{positions > 1 ? 's' : ''}</span>
            <button onClick={() => setF((x) => ({ ...x, positions: Math.min(20, x.positions + 1) }))} style={{ width: 30, height: 30, borderRadius: '50%', background: T.grad, border: 'none', color: '#fff', fontSize: 15, cursor: 'pointer' }}>＋</button>
          </div>
        </Fld>

        {structure.is_ess && (
          <Fld label="Type de mission">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button onClick={() => setF((x) => ({ ...x, solid: false }))} style={{ background: !f.solid ? '#fff' : T.row, color: !f.solid ? '#000' : T.sub, border: `1px solid ${!f.solid ? '#fff' : T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                Rémunérée
              </button>
              <button onClick={() => setF((x) => ({ ...x, solid: true }))} style={{ background: f.solid ? '#16a34a' : T.row, color: f.solid ? '#fff' : '#4ade80', border: `1px solid ${f.solid ? '#16a34a' : '#14532d'}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                Solidaire
              </button>
            </div>
          </Fld>
        )}

        {!f.solid && (
          <>
            <Fld label="Tarif">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                <button onClick={() => setF((x) => ({ ...x, rateMode: 'hourly' }))} style={{ background: f.rateMode === 'hourly' ? '#fff' : T.row, color: f.rateMode === 'hourly' ? '#000' : T.sub, border: `1px solid ${f.rateMode === 'hourly' ? '#fff' : T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                  À l'heure
                </button>
                <button onClick={() => setF((x) => ({ ...x, rateMode: 'fixed' }))} style={{ background: f.rateMode === 'fixed' ? '#fff' : T.row, color: f.rateMode === 'fixed' ? '#000' : T.sub, border: `1px solid ${f.rateMode === 'fixed' ? '#fff' : T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                  Montant fixe
                </button>
              </div>
              <input
                aria-label={f.rateMode === 'hourly' ? 'Tarif horaire' : 'Montant fixe'}
                value={f.rateMode === 'hourly' ? f.hourly : f.fixed}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^\d,.]/g, '');
                  setF((x) => (x.rateMode === 'hourly' ? { ...x, hourly: value } : { ...x, fixed: value }));
                }}
                inputMode="decimal"
                placeholder={f.rateMode === 'hourly' ? '12' : '75'}
                style={{ ...inp, marginBottom: 0 }}
              />
            </Fld>
          </>
        )}

        <div style={{ marginBottom: 12, background: T.row, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '12px 13px' }}>
          <div style={{ color: T.mu, fontSize: 10.5, lineHeight: 1.55, marginBottom: 7 }}>{summary || 'Choisis la date et les horaires.'}</div>
          <div style={{ color: T.text, fontSize: 12.5, fontWeight: 900, marginBottom: 5 }}>
            {positions} personne{positions > 1 ? 's' : ''} · {missionDays || 1} jour{(missionDays || 1) > 1 ? 's' : ''} · {formatHours(minutes)} par personne
          </div>
          <div style={{ color: T.sub, fontSize: 11, marginBottom: 10 }}>{formatHoursCompact(totalWorkerHours)} de travail au total</div>
          <div style={{ color: T.text, fontSize: 16, fontWeight: 900 }}>Coût total estimé : {formatMoney(structureTotalCents)}</div>
          {!f.solid && (
            <button onClick={() => setShowDetail((v) => !v)} style={{ marginTop: 9, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10.5, color: T.mu, textDecoration: 'underline', fontWeight: 600, padding: 0 }}>
              {showDetail ? 'Masquer le détail' : 'Voir le détail'}
            </button>
          )}
          {showDetail && !f.solid && (
            <div style={{ marginTop: 9, borderTop: `1px solid ${T.cb}`, paddingTop: 9, display: 'grid', gap: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: T.sub, fontSize: 11 }}><span>Rémunération totale des travailleurs</span><strong style={{ color: T.text }}>{formatMoney(workerSubtotalCents)}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: T.sub, fontSize: 11 }}><span>Frais de service UROSI</span><strong style={{ color: T.text }}>{formatMoney(serviceFeeCents)}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: T.text, fontSize: 12, fontWeight: 900 }}><span>Total à payer</span><span>{formatMoney(structureTotalCents)}</span></div>
            </div>
          )}
          {f.solid && <div style={{ color: T.green, fontSize: 11, fontWeight: 800, marginTop: 8 }}>Mission solidaire : aucun coût, comptabilisée dans le CV vivant.</div>}
        </div>

        <Fld label="Descriptif">
          <textarea aria-label="Descriptif" value={f.desc} onChange={(e) => setF((x) => ({ ...x, desc: e.target.value }))} rows={3} placeholder="Ce que le travailleur fera concrètement…" style={{ ...inp, resize: 'none', lineHeight: 1.5 }} />
        </Fld>
        <Fld label="Tenue demandée">
          <input aria-label="Tenue demandée" value={f.dressCode} onChange={(e) => setF((x) => ({ ...x, dressCode: e.target.value }))} placeholder="Ex. pantalon noir et chaussures fermées" style={inp} />
        </Fld>
        <Fld label="Équipement">
          <input aria-label="Équipement" value={f.equipment} onChange={(e) => setF((x) => ({ ...x, equipment: e.target.value }))} placeholder="Ex. fourni sur place, gants à apporter…" style={inp} />
        </Fld>
        <Fld label="Consignes">
          <textarea aria-label="Consignes" value={f.instructions} onChange={(e) => setF((x) => ({ ...x, instructions: e.target.value }))} rows={3} placeholder="Accès, personne à contacter, arrivée sur place…" style={{ ...inp, resize: 'none', lineHeight: 1.5 }} />
        </Fld>

        {(error || validationMessage) && <div style={{ fontSize: 11, color: T.red, marginBottom: 10 }}>{error || validationMessage}</div>}
        <div className="urosi-modal-actions">
          <button onClick={publish} disabled={!ok || busy} style={{ width: '100%', background: ok && !busy ? '#fff' : T.row, color: ok && !busy ? '#000' : T.mu, border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: ok && !busy ? 'pointer' : 'not-allowed' }}>
            {busy ? 'Publication…' : f.solid ? 'Publier · Solidaire (0 €)' : `Publier · ${formatMoney(structureTotalCents)} au total`}
          </button>
        </div>
      </div>
    </div>
  );
}
