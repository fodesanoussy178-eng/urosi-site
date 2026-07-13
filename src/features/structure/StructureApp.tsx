import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { signOut } from '@/features/auth/authService';
import { T, FONT, inp } from '@/components/ui/theme';
import { Fld } from '@/components/ui/Fld';
import { DocModal, AideRegles, type DocKey } from '@/components/ui/DocModal';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { ChatSheet } from '@/components/ui/ChatSheet';
import { WalletCard } from '@/components/ui/WalletCard';
import { PriceSplit, splitPrice } from '@/components/ui/PriceSplit';
import { fetchMyStructures, createStructure, updateStructureAbout, subscribeStructure } from './structureService';
import { StatsPanel } from './StatsPanel';
import { fetchMissionsForStructure, createMission } from '@/features/missions/missionsService';
import {
  fetchApplicationsForMission,
  updateApplicationStatus,
  type ApplicationWithApplicant,
} from '@/features/missions/applicationsService';
import { rate, fetchRatedApplicationIds, fetchWorkerReputation, type WorkerReputation } from '@/features/missions/ratingsService';
import { fetchDelaysForApplications } from '@/features/missions/feedbackService';
import { confirmRemoteAttendance, reportWorkerAbsence } from '@/features/missions/attendanceService';
import { fetchUnreadCounts } from '@/features/messages/messagesService';
import { fetchCommissionRates, type CommissionRates } from '@/features/pricing/pricingService';
import { geocodeMelCity } from '@/lib/geo';
import { spanDays, totalMinutes } from '@/lib/slots';
import { isFounderCode } from '@/lib/founder';
import { formatSiret, isValidSiret, normalizeSiret } from '@/features/structure/verification';
import type { Mission, Structure } from '@/features/missions/types';
import type { MissionSlot } from '@/types/database.types';
import { formatEuros, formatHours } from '@/lib/format';

type Tab = 'missions' | 'candidats' | 'pilotage';

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type CandWithMission = ApplicationWithApplicant & { missionTitle: string };

function isVerifiedStructure(structure: Structure | null): boolean {
  if (!structure) return false;
  return structure.verification_status === 'verified' || structure.verification_status === 'founder_bypass' || Boolean(structure.siret);
}

function verificationBadge(structure: Structure): { label: string; color: string; bg: string } {
  if (structure.verification_status === 'founder_bypass' || structure.founder_bypass) return { label: 'Clé fondateur', color: T.green, bg: T.greenBg };
  if (structure.verification_status === 'verified' || structure.siret) return { label: '✓ SIRET vérifié', color: T.green, bg: T.greenBg };
  if (structure.verification_status === 'rejected') return { label: 'SIRET refusé', color: T.red, bg: T.redBg };
  return { label: 'Vérification SIRET', color: T.amber, bg: T.amberBg };
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
  const [panelC, setPanelC] = useState<CandWithMission | null>(null);
  const [panelRep, setPanelRep] = useState<WorkerReputation | null>(null);
  const [ratingCand, setRatingCand] = useState<CandWithMission | null>(null);
  const [chatFor, setChatFor] = useState<CandWithMission | null>(null);
  const [docKey, setDocKey] = useState<DocKey | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const [vf, setVf] = useState({ nom: '', siret: '', founderCode: '' });
  const [toast, setToast] = useState<string | null>(null);
  const tr = useRef<ReturnType<typeof setTimeout>>();

  function notif(m: string) {
    setToast(m);
    clearTimeout(tr.current);
    tr.current = setTimeout(() => setToast(null), 3000);
  }

  async function loadMissionData(missions: Mission[]) {
    if (!session) return;
    const entries = await Promise.all(missions.map(async (m) => [m.id, await fetchApplicationsForMission(m.id)] as const));
    setCands(new Map(entries));
    const allApps = entries.flatMap(([, list]) => list);
    const appIds = allApps.map((a) => a.id);
    const [delayMap, rated, unreadMap] = await Promise.all([
      fetchDelaysForApplications(appIds),
      fetchRatedApplicationIds(appIds, 'structure_to_worker'),
      fetchUnreadCounts(appIds, session.user.id),
    ]);
    setDelays(delayMap);
    setRatedIds(rated);
    setUnread(unreadMap);
  }

  async function reload() {
    if (!structure) return;
    const missions = await fetchMissionsForStructure(structure.id);
    setMis(missions);
    await loadMissionData(missions);
  }

  useEffect(() => {
    (async () => {
      if (!session) return;
      try {
        let mine = await fetchMyStructures(session.user.id);
        if (mine.length === 0) {
          const meta = session.user.user_metadata as Record<string, string | boolean | null>;
          if (meta.structure_name) {
            const founder = isFounderCode(String(meta.founder_code ?? ''));
            const metaSiret = String(meta.siret ?? '');
            const metaSiretOk = isValidSiret(metaSiret);
            const created = await createStructure(
              session.user.id,
              String(meta.structure_name),
              founder ? undefined : normalizeSiret(metaSiret),
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
    const founder = isFounderCode(vf.founderCode);
    const siretOk = isValidSiret(vf.siret);
    if (!(vf.nom.trim().length >= 2 && (founder || siretOk))) {
      notif('SIRET valide requis, sauf accès fondateur.');
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
      notif(e instanceof Error ? e.message : 'Création impossible.');
    }
  }

  async function activateSubscription() {
    if (!structure || subBusy) return;
    setSubBusy(true);
    try {
      await subscribeStructure(structure.id);
      setStructure((s) => (s ? { ...s, subscription_active: true, subscribed_at: new Date().toISOString() } : s));
      notif('✓ Abonnement activé — tu peux publier des missions.');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Activation impossible.');
    } finally {
      setSubBusy(false);
    }
  }

  async function decide(applicationId: string, dec: 'accepted' | 'rejected') {
    try {
      await updateApplicationStatus(applicationId, dec);
      await loadMissionData(mis);
      setPanelC(null);
      notif(dec === 'accepted' ? 'Candidat accepté — le fil de discussion est ouvert.' : 'Candidat refusé.');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Action impossible.');
    }
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
      await loadMissionData(mis);
      notif('Note enregistrée — elle apparaît dans le CV vivant du travailleur.');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Notation impossible.');
    } finally {
      setRatingCand(null);
    }
  }

  async function validationDistance(c: CandWithMission, type: 'start' | 'end') {
    try {
      await confirmRemoteAttendance(c.id, type);
      await loadMissionData(mis);
      notif(type === 'start' ? 'Début validé à distance.' : 'Fin validée à distance — paiement préparé pour J+3.');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Validation impossible.');
    }
  }

  async function signalerAbsence(c: CandWithMission) {
    try {
      await reportWorkerAbsence(c.id, 'travailleur absent / impossible à joindre');
      await loadMissionData(mis);
      notif('Absence signalée — le travailleur peut répondre, aucune sanction automatique.');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Signalement impossible.');
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
  const pending = allCands.filter((c) => c.status === 'pending');
  const completedByWorker = new Map<string, CandWithMission[]>();
  for (const c of allCands.filter((x) => x.status === 'completed')) {
    completedByWorker.set(c.worker_id, [...(completedByWorker.get(c.worker_id) ?? []), c]);
  }
  const habitues = [...completedByWorker.entries()]
    .map(([workerId, list]) => ({ workerId, nom: list[0]?.profile?.full_name || 'Travailleur', fois: list.length }))
    .sort((a, b) => b.fois - a.fois);
  const shownCands = candMis ? allCands.filter((c) => c.mission_id === candMis) : allCands;
  const misTitle = (mid: string) => mis.find((m) => m.id === mid)?.title ?? '—';
  const candCount = (mid: string) => (cands.get(mid) ?? []).filter((c) => c.status === 'pending').length;
  const unreadTotal = [...unread.values()].reduce((s, v) => s + v, 0);
  const formFounder = isFounderCode(vf.founderCode);
  const formSiretOk = isValidSiret(vf.siret);
  const canCreateStructure = vf.nom.trim().length >= 2 && (formFounder || formSiretOk);
  const structureVerified = isVerifiedStructure(structure);

  if (loading) {
    return <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: T.mu, fontSize: 12 }}>Chargement…</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT, padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: T.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: '#fff', fontSize: 15 }}>U</div>
            <span style={{ fontWeight: 900, fontSize: 15, color: T.text }}>Espace structure</span>
          </div>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
            {session && <NotificationBell profileId={session.user.id} onDataChanged={() => reload().catch(() => undefined)} />}
            <a href="/demo?role=structure" style={{ fontSize: 10, color: T.cyan, background: 'none', border: `1px solid ${T.cb}`, borderRadius: 6, padding: '4px 9px', textDecoration: 'none' }}>Démo</a>
            <button onClick={() => setDocKey('cgu')} style={{ fontSize: 10, color: T.mu, background: 'none', border: `1px solid ${T.cb}`, borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }}>? Aide</button>
            <button onClick={() => signOut()} style={{ fontSize: 10, color: T.mu, background: 'none', border: `1px solid ${T.cb}`, borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }}>Déconnexion</button>
          </div>
        </div>

        {toast && <div style={{ marginBottom: 10, background: T.card, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '7px 11px', fontSize: 11, color: T.sub }}>{toast}</div>}

        {!structure ? (
          <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 17 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 4 }}>Avant de publier, on identifie ta structure</div>
            <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5, marginBottom: 16 }}>Seules les structures identifiées (SIRET) peuvent publier des missions.</div>
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
            <Fld label="Code fondateur (optionnel)">
              <input aria-label="Code fondateur" value={vf.founderCode} onChange={(e) => setVf((x) => ({ ...x, founderCode: e.target.value.toUpperCase() }))} placeholder="Réservé fondateur" style={inp} autoCapitalize="characters" />
              {formFounder && <div style={{ fontSize: 9.5, color: T.green, marginTop: -7, marginBottom: 10 }}>✓ SIRET facultatif pour le fondateur</div>}
            </Fld>
            <button onClick={createFromForm} disabled={!canCreateStructure} style={{ width: '100%', background: canCreateStructure ? '#fff' : T.row, color: canCreateStructure ? '#000' : T.mu, border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: canCreateStructure ? 'pointer' : 'not-allowed', marginTop: 4 }}>
              {canCreateStructure ? 'Enregistrer ma structure' : 'SIRET valide ou clé fondateur'}
            </button>
          </div>
        ) : (
          <>
            {/* Bandeau structure */}
            <div style={{ background: T.card, border: `1px solid ${T.greenBorder}`, borderRadius: 12, padding: '12px 15px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'hsl(200 58% 46%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                  {structure.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{structure.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                    {structure.is_ess && <span style={{ fontSize: 8, fontWeight: 700, color: T.green, background: T.greenBg, borderRadius: 8, padding: '1px 6px' }}>🤝 Association · ESS</span>}
                    <span style={{ fontSize: 8, fontWeight: 700, color: verificationBadge(structure).color, background: verificationBadge(structure).bg, borderRadius: 8, padding: '1px 6px' }}>{verificationBadge(structure).label}</span>
                    {structure.subscription_active && <span style={{ fontSize: 8, fontWeight: 700, color: T.cyan, background: '#22d3ee15', borderRadius: 8, padding: '1px 6px' }}>✓ Abonnée</span>}
                  </div>
                </div>
              </div>
              <AboutEditor structure={structure} onSaved={(about) => setStructure((s) => (s ? { ...s, about } : s))} notif={notif} />
            </div>

            {/* Abonnement requis pour publier */}
            {!structure.subscription_active && (
              <div style={{ background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 12, padding: '12px 15px', marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: T.amber, marginBottom: 4 }}>Abonnement requis pour publier</div>
                <div style={{ fontSize: 10.5, color: T.sub, lineHeight: 1.5, marginBottom: 10 }}>
                  L'abonnement UROSI donne accès à la publication illimitée de missions, aux règles de rémunération intelligente et aux statistiques.
                </div>
                <button onClick={activateSubscription} disabled={subBusy} style={{ width: '100%', background: T.grad, color: '#fff', border: 'none', borderRadius: 9, padding: '11px 0', fontSize: 12.5, fontWeight: 900, cursor: 'pointer' }}>
                  {subBusy ? '…' : "Activer l'abonnement"}
                </button>
              </div>
            )}

            {/* Onglets */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {(
                [
                  ['missions', 'Missions', mis.length],
                  ['candidats', 'Candidats', pending.length + unreadTotal],
                  ['pilotage', 'Pilotage', 0],
                ] as [Tab, string, number][]
              ).map(([k, l, n]) => (
                <button
                  key={k}
                  onClick={() => {
                    setTab(k);
                    if (k === 'candidats') setCandMis(null);
                  }}
                  style={{ flex: 1, background: tab === k ? '#fff' : T.card, color: tab === k ? '#000' : T.sub, border: `1px solid ${tab === k ? '#fff' : T.cb}`, borderRadius: 9, padding: '8px 0', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}
                >
                  {l}
                  {n > 0 && <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 800, color: tab === k ? '#000' : T.cyan }}>{n}</span>}
                </button>
              ))}
            </div>

            {/* ── MISSIONS ── */}
            {tab === 'missions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {!structureVerified && (
                  <div style={{ background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 10, padding: '10px 12px', fontSize: 10.5, color: T.amber, lineHeight: 1.45 }}>
                    Vérification SIRET requise avant publication, sauf accès fondateur.
                  </div>
                )}
                <button onClick={() => structureVerified && setShowPub(true)} disabled={!structureVerified} style={{ width: '100%', background: structureVerified ? T.grad : T.row, color: structureVerified ? '#fff' : T.mu, border: 'none', borderRadius: 11, padding: '12px 0', fontSize: 13, fontWeight: 900, cursor: structureVerified ? 'pointer' : 'not-allowed', marginBottom: 2 }}>
                  {structureVerified ? '＋ Publier une mission' : 'Structure à vérifier'}
                </button>
                {mis.length === 0 && <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 20, textAlign: 'center', fontSize: 11, color: T.mu }}>Aucune mission publiée pour l'instant.</div>}
                {mis.map((m, i) => {
                  const cc = candCount(m.id);
                  return (
                    <div key={m.id}>
                      {i === 0 && <div style={{ fontSize: 9, fontWeight: 800, color: T.cyan, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 4 }}>★ Dernière mission publiée</div>}
                      <div style={{ background: T.card, border: `1px solid ${i === 0 ? '#0e7490' : T.cb}`, borderRadius: 12, padding: '13px 15px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 7 }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 2 }}>
                              {m.is_urgent && <span style={{ color: T.amber }}>⚡ </span>}
                              {m.title}
                            </div>
                            <div style={{ fontSize: 10, color: T.mu }}>
                              📍 {m.city || 'MEL'} · {m.scheduled_date}
                              {m.start_time ? ` · ${m.start_time.slice(0, 5)}` : ''} · {formatHours(m.duration_minutes)}
                            </div>
                            {m.detail && <div style={{ fontSize: 10, color: T.sub, marginTop: 4, lineHeight: 1.45 }}>{m.detail}</div>}
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                            <div style={{ fontSize: 16, fontWeight: 900, color: m.is_solidaire ? T.green : T.text }}>{m.is_solidaire ? 'Solidaire' : euros(m.worker_rate_cents)}</div>
                            {!m.is_solidaire && m.base_rate_cents != null && m.worker_rate_cents > m.base_rate_cents && (
                              <div style={{ fontSize: 9, color: T.green, fontWeight: 700 }}>⚡ base {euros(m.base_rate_cents)}</div>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: m.status === 'open' ? T.green : T.mu, background: m.status === 'open' ? T.greenBg : T.row, borderRadius: 8, padding: '2px 8px' }}>
                            {m.status === 'open' ? 'Active' : m.status === 'closed' ? 'Clôturée' : 'Annulée'}
                          </span>
                          {cc > 0 ? (
                            <button
                              onClick={() => {
                                setCandMis(m.id);
                                setTab('candidats');
                              }}
                              style={{ fontSize: 10, fontWeight: 700, color: T.cyan, background: '#22d3ee15', border: 'none', borderRadius: 8, padding: '3px 9px', cursor: 'pointer' }}
                            >
                              {cc} candidat{cc > 1 ? 's' : ''} →
                            </button>
                          ) : (
                            <span style={{ fontSize: 10, color: T.mu }}>Aucun candidat pour l'instant</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
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
                          <button onClick={() => decide(c.id, 'accepted')} style={{ background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}`, borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                            ✓ Accepter
                          </button>
                          <button onClick={() => decide(c.id, 'rejected')} style={{ background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            Refuser
                          </button>
                        </div>
                      )}
                      {['accepted', 'in_progress', 'payment_pending', 'completed'].includes(c.status) && (
                        <div style={{ padding: '0 14px 12px', display: 'grid', gridTemplateColumns: c.status === 'completed' && !ratedIds.has(c.id) ? '1fr 1fr' : '1fr', gap: 6 }}>
                          <button onClick={() => setChatFor(c)} style={{ position: 'relative', background: '#1d4ed815', color: '#93c5fd', border: '1px solid #1e40af', borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                            💬 Message
                            {unreadCount > 0 && (
                              <span style={{ position: 'absolute', top: -6, right: -4, minWidth: 15, height: 15, borderRadius: 8, background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                                {unreadCount}
                              </span>
                            )}
                          </button>
                          {c.status === 'completed' && !ratedIds.has(c.id) && (
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

            {/* ── PILOTAGE : stats + wallet + habitués ── */}
            {tab === 'pilotage' && session && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <StatsPanel structureId={structure.id} />
                <WalletCard profileId={session.user.id} mode="structure" notif={notif} />
                <AideRegles onOpen={setDocKey} />
                <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '13px 15px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Habitués</div>
                  {habitues.length === 0 && <div style={{ fontSize: 11, color: T.mu }}>Les travailleurs qui terminent des missions chez toi apparaîtront ici.</div>}
                  {habitues.map((h) => (
                    <div key={h.workerId} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderTop: `1px solid ${T.cb}` }}>
                      <div style={{ width: 30, height: 30, borderRadius: 9, background: 'hsl(265 58% 46%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                        {h.nom.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: T.text }}>{h.nom}</div>
                      <span style={{ fontSize: 14, fontWeight: 900, color: T.amber }}>{h.fois}×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Panneau candidat */}
            {panelC && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 400 }} onClick={() => setPanelC(null)}>
                <div style={{ width: '100%', maxWidth: 420, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 26px', fontFamily: FONT }} onClick={(e) => e.stopPropagation()}>
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
                  {panelC.status === 'pending' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <button onClick={() => decide(panelC.id, 'accepted')} style={{ background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}`, borderRadius: 8, padding: '11px 0', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                        ✓ Accepter
                      </button>
                      <button onClick={() => decide(panelC.id, 'rejected')} style={{ background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: '11px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                        Refuser
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Notation du travailleur */}
            {ratingCand && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 400 }} onClick={() => setRatingCand(null)}>
                <div style={{ width: '100%', maxWidth: 420, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 26px', fontFamily: FONT }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: T.text, marginBottom: 3 }}>Noter {ratingCand.profile?.full_name || 'le travailleur'}</div>
                  <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5, marginBottom: 12 }}>
                    Mission « {ratingCand.missionTitle} ». Ta note apparaîtra dans son CV vivant — informative, jamais bloquante (CGU).
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => noterTravailleur(n)} style={{ flex: 1, padding: '12px 0', fontSize: 22, background: T.row, border: `1px solid ${T.cb}`, borderRadius: 10, cursor: 'pointer', color: '#f59e0b' }}>
                        ★
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setRatingCand(null)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.mu, padding: '4px 0' }}>
                    Plus tard
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
                onClose={() => setShowPub(false)}
                onPublished={(m) => {
                  setMis((l) => [m, ...l]);
                  setShowPub(false);
                  setTab('missions');
                  notif(`« ${m.title} » publiée${m.pricing_breakdown && m.pricing_breakdown.adjustments.length > 0 ? ` à ${euros(m.worker_rate_cents)} (rémunération boostée)` : ''}.`);
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
              notif(e instanceof Error ? e.message : 'Enregistrement impossible.');
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

// Publication volontairement simple : la structure indique le planning
// (jusqu'à 3 jours), le nombre de places et le montant proposé. Le coût
// total (commission incluse) est affiché, le détail au clic.
function PublishModal({ structure, onClose, onPublished }: { structure: Structure; onClose: () => void; onPublished: (m: Mission) => void }) {
  const [f, setF] = useState({ t: '', adr: '', pay: 72, desc: '', places: 1, solid: false });
  const [slots, setSlots] = useState<MissionSlot[]>([{ date: todayPlus(1), start: '11:00', end: '15:00' }]);
  const [rates, setRates] = useState<CommissionRates | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCommissionRates().then(setRates).catch(() => undefined);
  }, []);

  const minutes = totalMinutes(slots);
  const days = spanDays(slots);
  const tooLong = days > 3;
  const slotsOk = slots.length > 0 && minutes >= 60 && !tooLong && slots.every((sl) => sl.date && sl.start < sl.end);
  const ok = f.t.trim().length >= 2 && f.adr.trim().length >= 2 && slotsOk && (f.solid || f.pay > 0);
  const split = rates && !f.solid ? splitPrice(Math.round(f.pay * 100), rates.structurePct, rates.workerPct) : null;

  function setSlot(i: number, patch: Partial<MissionSlot>) {
    setSlots((prev) => prev.map((sl, idx) => (idx === i ? { ...sl, ...patch } : sl)));
  }

  async function publish() {
    if (!ok || busy) return;
    setError(null);
    setBusy(true);
    try {
      const coords = geocodeMelCity(f.adr);
      const mission = await createMission({
        structure_id: structure.id,
        title: f.t.trim(),
        detail: f.desc.trim() || null,
        city: f.adr.trim(),
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        // scheduled_date / start_time / duration_minutes sont recalculés par
        // le serveur à partir du planning (trigger missions_apply_slots).
        scheduled_date: slots[0]?.date ?? todayPlus(1),
        start_time: slots[0]?.start ?? null,
        duration_minutes: minutes,
        slots,
        places: f.places,
        worker_rate_cents: f.solid ? 0 : Math.round(f.pay * 100),
        base_rate_cents: f.solid ? null : Math.round(f.pay * 100),
        is_solidaire: f.solid,
      });
      onPublished(mission);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publication impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 400 }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 420, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 26px', fontFamily: FONT, maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: T.text }}>Nouvelle mission</span>
          <button onClick={onClose} style={{ background: T.row, border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', color: T.sub, fontSize: 14 }}>×</button>
        </div>

        <Fld label="Intitulé de la mission">
          <input aria-label="Intitulé" value={f.t} onChange={(e) => setF((x) => ({ ...x, t: e.target.value }))} placeholder="Intitulé de la mission" style={inp} autoFocus />
        </Fld>
        <Fld label="Adresse / ville">
          <input aria-label="Adresse" value={f.adr} onChange={(e) => setF((x) => ({ ...x, adr: e.target.value }))} placeholder="Adresse ou ville" style={inp} />
        </Fld>

        <Fld label="Planning (jusqu'à 3 jours)">
          {slots.map((sl, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <input aria-label={`Jour ${i + 1}`} type="date" value={sl.date} onChange={(e) => setSlot(i, { date: e.target.value })} style={{ ...inp, marginBottom: 0, flex: 1.4, padding: '10px 8px', fontSize: 11.5 }} />
              <input aria-label={`Début ${i + 1}`} type="time" value={sl.start} onChange={(e) => setSlot(i, { start: e.target.value })} style={{ ...inp, marginBottom: 0, flex: 1, padding: '10px 6px', fontSize: 11.5 }} />
              <span style={{ color: T.mu, fontSize: 11 }}>→</span>
              <input aria-label={`Fin ${i + 1}`} type="time" value={sl.end} onChange={(e) => setSlot(i, { end: e.target.value })} style={{ ...inp, marginBottom: 0, flex: 1, padding: '10px 6px', fontSize: 11.5 }} />
              {slots.length > 1 && (
                <button onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Supprimer le créneau" style={{ background: T.redBg, color: T.red, border: 'none', borderRadius: 7, width: 26, height: 26, cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>
                  ×
                </button>
              )}
            </div>
          ))}
          {slots.length < 12 && (
            <button
              onClick={() => setSlots((prev) => [...prev, { date: prev[prev.length - 1]?.date ?? todayPlus(1), start: '18:00', end: '22:00' }])}
              style={{ background: 'none', border: `1px dashed ${T.cb}`, color: T.sub, borderRadius: 8, padding: '7px 0', width: '100%', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >
              ＋ Ajouter un créneau
            </button>
          )}
          <div style={{ fontSize: 10, color: tooLong ? T.red : T.mu, marginTop: 6 }}>
            {tooLong
              ? 'Une mission dure 3 jours maximum.'
              : minutes > 0
                ? `Durée totale : ${formatHours(minutes)}${days > 1 ? ` sur ${days} jours` : ''}`
                : 'Ajoute au moins un créneau (1h minimum).'}
          </div>
        </Fld>

        <Fld label="Nombre de places">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setF((x) => ({ ...x, places: Math.max(1, x.places - 1) }))} style={{ width: 30, height: 30, borderRadius: '50%', background: T.row, border: `1px solid ${T.cb}`, color: T.text, fontSize: 15, cursor: 'pointer' }}>−</button>
            <span style={{ fontSize: 15, fontWeight: 900, color: T.text, minWidth: 70, textAlign: 'center' }}>{f.places} place{f.places > 1 ? 's' : ''}</span>
            <button onClick={() => setF((x) => ({ ...x, places: Math.min(20, x.places + 1) }))} style={{ width: 30, height: 30, borderRadius: '50%', background: T.grad, border: 'none', color: '#fff', fontSize: 15, cursor: 'pointer' }}>＋</button>
          </div>
        </Fld>

        <Fld label="Descriptif">
          <textarea aria-label="Descriptif" value={f.desc} onChange={(e) => setF((x) => ({ ...x, desc: e.target.value }))} rows={3} placeholder="Ce que le travailleur fera concrètement…" style={{ ...inp, resize: 'none', lineHeight: 1.5 }} />
        </Fld>

        {structure.is_ess && (
          <Fld label="Type de mission">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button onClick={() => setF((x) => ({ ...x, solid: false }))} style={{ background: !f.solid ? '#fff' : T.row, color: !f.solid ? '#000' : T.sub, border: `1px solid ${!f.solid ? '#fff' : T.cb}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                € Rémunérée
              </button>
              <button onClick={() => setF((x) => ({ ...x, solid: true }))} style={{ background: f.solid ? '#16a34a' : T.row, color: f.solid ? '#fff' : '#4ade80', border: `1px solid ${f.solid ? '#16a34a' : '#14532d'}`, borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                🤝 Solidaire (0 €)
              </button>
            </div>
          </Fld>
        )}

        {f.solid ? (
          <div style={{ background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 9, padding: '11px 13px', marginBottom: 12, fontSize: 10.5, color: T.green, lineHeight: 1.55 }}>
            🤝 Mission bénévole à 0 €. Elle comptera dans le CV vivant des participants.
          </div>
        ) : (
          <>
            <Fld label="Montant proposé (€)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => setF((x) => ({ ...x, pay: Math.max(5, x.pay - 5) }))} style={{ width: 34, height: 34, borderRadius: '50%', background: T.row, border: `1px solid ${T.cb}`, color: T.text, fontSize: 18, cursor: 'pointer' }}>
                  −
                </button>
                <input
                  aria-label="Montant proposé"
                  value={String(f.pay)}
                  onChange={(e) => setF((x) => ({ ...x, pay: Math.max(0, Number(e.target.value.replace(',', '.')) || 0) }))}
                  inputMode="decimal"
                  style={{ ...inp, marginBottom: 0, width: 90, textAlign: 'center', fontSize: 18, fontWeight: 900 }}
                />
                <button onClick={() => setF((x) => ({ ...x, pay: x.pay + 5 }))} style={{ width: 34, height: 34, borderRadius: '50%', background: T.grad, border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}>
                  +
                </button>
              </div>
            </Fld>
            {split && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>
                  Coût total estimé : {euros(split.totalStructureCents)}
                  <button
                    onClick={() => setShowDetail((v) => !v)}
                    style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10.5, color: T.mu, textDecoration: 'underline', fontWeight: 600 }}
                  >
                    {showDetail ? 'Masquer' : 'Voir le détail'}
                  </button>
                </div>
                {showDetail && (
                  <div style={{ marginTop: 8 }}>
                    <PriceSplit values={split} side="structure" />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {error && <div style={{ fontSize: 11, color: T.red, marginBottom: 10 }}>{error}</div>}
        <button onClick={publish} disabled={!ok || busy} style={{ width: '100%', background: ok && !busy ? '#fff' : T.row, color: ok && !busy ? '#000' : T.mu, border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: ok && !busy ? 'pointer' : 'not-allowed' }}>
          {busy ? '…' : ok ? (f.solid ? 'Publier — Solidaire (0 €)' : `Publier — ${f.pay} €`) : 'Complète la mission'}
        </button>
      </div>
    </div>
  );
}
