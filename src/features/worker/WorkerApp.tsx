import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { signOut } from '@/features/auth/authService';
import { updateProfile } from '@/features/profile/profileService';
import { T, FONT, inp } from '@/components/ui/theme';
import { QRBadge } from '@/components/ui/QRBadge';
import { Stars } from '@/components/ui/Stars';
import { DocModal, AideRegles, type DocKey } from '@/components/ui/DocModal';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { ChatSheet } from '@/components/ui/ChatSheet';
import { WalletCard } from '@/components/ui/WalletCard';
import { PricingDetails } from '@/components/ui/PricingDetails';
import { fetchOpenMissions, type MissionWithStructure } from '@/features/missions/missionsService';
import {
  applyToMission,
  completeApplication,
  updateApplicationStatus,
  fetchMyApplications,
  type ApplicationWithMission,
} from '@/features/missions/applicationsService';
import { rate, fetchStructureRatings, fetchWorkerReceivedRatings, type StructureRating } from '@/features/missions/ratingsService';
import { notifyDelay, submitReport, REPORT_MOTIFS } from '@/features/missions/feedbackService';
import { fetchUnreadCounts } from '@/features/messages/messagesService';
import { fetchWorkerStats, type WorkerStats } from '@/features/stats/statsService';
import { distanceKm, formatDistance, type LatLng } from '@/lib/geo';
import type { ReportMotif } from '@/types/database.types';
import { formatEuros, formatHours } from '@/lib/format';

type Tab = 'flux' | 'moi' | 'profil';

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

const SHEET = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 } as const;
const SHEET_BODY = { width: '100%', maxWidth: 430, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 28px' } as const;

export function WorkerApp() {
  const { session, profile, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>('flux');
  const [flux, setFlux] = useState<MissionWithStructure[]>([]);
  const [apps, setApps] = useState<ApplicationWithMission[]>([]);
  const [receivedRatings, setReceivedRatings] = useState<Map<string, number>>(new Map());
  const [structRatings, setStructRatings] = useState<Map<string, StructureRating>>(new Map());
  const [unread, setUnread] = useState<Map<string, number>>(new Map());
  const [stats, setStats] = useState<WorkerStats | null>(null);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MissionWithStructure | null>(null);
  const [structSheet, setStructSheet] = useState<MissionWithStructure | null>(null);
  const [ratingFor, setRatingFor] = useState<ApplicationWithMission | null>(null);
  const [chatFor, setChatFor] = useState<ApplicationWithMission | null>(null);
  const [alrt, setAlrt] = useState<{ app: ApplicationWithMission; type: 'retard' | 'annulation' } | null>(null);
  const [signal, setSignal] = useState<ApplicationWithMission | null>(null);
  const [sigMotif, setSigMotif] = useState<ReportMotif | null>(null);
  const [sigNote, setSigNote] = useState('');
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
      const activeIds = myApps.filter((a) => a.status === 'accepted' || a.status === 'completed').map((a) => a.id);
      setUnread(await fetchUnreadCounts(activeIds, session.user.id));
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
  const acceptedApps = apps.filter((a) => a.status === 'accepted');
  const pendingCount = apps.filter((a) => a.status === 'pending').length;
  const completedApps = apps.filter((a) => a.status === 'completed');
  const cvCount = completedApps.length;
  const receivedScores = completedApps.map((a) => receivedRatings.get(a.id)).filter((s): s is number => Boolean(s));
  const receivedAvg = receivedScores.length ? receivedScores.reduce((s, v) => s + v, 0) / receivedScores.length : null;
  const unreadTotal = [...unread.values()].reduce((s, v) => s + v, 0);

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

  async function terminer(a: ApplicationWithMission) {
    if (busyId) return;
    setBusyId(a.id);
    try {
      await completeApplication(a.id);
      await load();
      setRatingFor(a);
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Action impossible.');
    } finally {
      setBusyId(null);
    }
  }

  async function noterStructure(score: number) {
    if (!session || !ratingFor?.mission) return;
    try {
      await rate({
        applicationId: ratingFor.id,
        structureId: ratingFor.mission.structure_id,
        workerId: session.user.id,
        score,
        direction: 'worker_to_structure',
      });
      await load();
      notif('Mission ajoutée à ton CV vivant ✓ — paiement crédité sur ton wallet.');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Notation impossible.');
    } finally {
      setRatingFor(null);
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
      await submitReport({ applicationId: signal.id, workerId: session.user.id, motif: sigMotif, note: sigNote });
      notif('Signalement transmis — on revient vers toi sous 24h.');
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Envoi impossible.');
    } finally {
      setSignal(null);
      setSigMotif(null);
      setSigNote('');
    }
  }

  function fluxCard(m: MissionWithStructure) {
    const sr = structRatings.get(m.structure_id);
    const dist = missionDistance(m);
    const boosted = !m.is_solidaire && m.pricing_breakdown && m.pricing_breakdown.adjustments.length > 0;
    return (
      <div key={m.id} onClick={() => setDetail(m)} style={{ background: T.card, border: `1px solid ${m.is_solidaire ? '#14532d' : T.cb}`, borderRadius: 14, cursor: 'pointer', overflow: 'hidden' }}>
        <div style={{ padding: '15px 15px 12px' }}>
          {m.is_solidaire ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 24, fontWeight: 900, color: T.green, letterSpacing: -1 }}>Solidaire</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: T.sub }}>0 €</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 33, fontWeight: 900, color: T.text, letterSpacing: -2, lineHeight: 1 }}>{euros(m.worker_rate_cents)}</span>
              {boosted && (
                <span style={{ fontSize: 9, fontWeight: 800, color: '#facc15', background: '#42200620', border: '1px solid #713f12', borderRadius: 10, padding: '2px 7px' }}>
                  ⚡ boostée{m.base_rate_cents != null ? ` (base ${euros(m.base_rate_cents)})` : ''}
                </span>
              )}
              {m.is_urgent && <span style={{ fontSize: 9, fontWeight: 800, color: T.amber, background: T.amberBg, borderRadius: 10, padding: '2px 7px' }}>Urgent</span>}
            </div>
          )}
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 5 }}>{m.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
            <span
              onClick={(e) => {
                e.stopPropagation();
                setStructSheet(m);
              }}
              style={{ fontSize: 11, fontWeight: 700, color: T.sub, textDecoration: 'underline', textDecorationColor: T.cb, cursor: 'pointer' }}
            >
              {m.structure?.name ?? 'Structure'} ›
            </span>
            {m.structure?.is_ess && <span style={{ fontSize: 8, fontWeight: 700, color: T.green, background: T.greenBg, borderRadius: 8, padding: '1px 6px' }}>🤝 Association</span>}
            {m.structure?.siret && <span style={{ fontSize: 8, fontWeight: 700, color: T.green, background: T.greenBg, borderRadius: 8, padding: '1px 5px' }}>✓ SIRET</span>}
            {sr ? (
              <>
                <Stars n={sr.average} size={11} />
                <span style={{ fontSize: 10, color: T.mu }}>
                  {sr.average.toFixed(1).replace('.', ',')} · {sr.count} avis
                </span>
              </>
            ) : (
              <span style={{ fontSize: 8, fontWeight: 700, color: T.cyan, background: '#22d3ee15', borderRadius: 8, padding: '1px 6px' }}>Nouvelle</span>
            )}
          </div>
          {m.is_solidaire && <div style={{ fontSize: 9.5, color: T.green, marginTop: 3, marginBottom: 1 }}>Compte dans ton CV vivant · sans rémunération</div>}
          <div style={{ fontSize: 10, color: T.mu }}>
            📍 {m.city || 'MEL'}
            {dist != null && <span style={{ color: T.cyan, fontWeight: 700 }}> · à {formatDistance(dist)}</span>} · {m.scheduled_date}
            {m.start_time ? ` · ${m.start_time.slice(0, 5)}` : ''} · {formatHours(m.duration_minutes)}
          </div>
        </div>
        <div style={{ padding: '0 15px 13px' }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              postuler(m);
            }}
            disabled={busyId === m.id}
            style={{ width: '100%', background: m.is_solidaire ? '#16a34a' : '#fff', color: m.is_solidaire ? '#fff' : '#000', border: 'none', borderRadius: 9, padding: '10px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer' }}
          >
            {busyId === m.id ? '…' : m.is_solidaire ? '🤝 Participer' : 'Accepter'}
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
                return (
                  <div key={a.id} style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: T.text, marginBottom: 2 }}>{a.mission?.title ?? 'Mission'}</div>
                    <div style={{ fontSize: 10, color: T.mu, marginBottom: 11 }}>
                      {a.mission?.city ? `📍 ${a.mission.city} · ` : ''}
                      {a.mission?.scheduled_date ?? ''}
                    </div>
                    <div style={{ background: '#fff', borderRadius: 11, padding: '14px 0 9px', display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 11 }}>
                      <QRBadge value={`${window.location.origin}/pointage/${a.id}/${a.checkin_token}`} />
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, fontWeight: 600 }}>
                        {a.checked_in_at ? '✓ Présence validée' : 'À faire scanner par la structure sur place'}
                      </div>
                    </div>
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
                    <button
                      onClick={() => terminer(a)}
                      disabled={busyId === a.id}
                      style={{ width: '100%', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer', marginBottom: 6 }}
                    >
                      {busyId === a.id ? '…' : '▦ Terminer la mission'}
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
              <AideRegles onOpen={setDocKey} />
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
              {!detail.is_solidaire && detail.pricing_breakdown && <PricingDetails breakdown={detail.pricing_breakdown} />}
              <div
                onClick={() => {
                  setStructSheet(detail);
                  setDetail(null);
                }}
                style={{ background: T.row, borderRadius: 11, padding: '12px 13px', marginBottom: 11, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{detail.structure?.name ?? 'Structure'}</span>
                  {detail.structure?.siret && <span style={{ fontSize: 8, fontWeight: 700, color: T.green, background: T.greenBg, borderRadius: 8, padding: '1px 5px' }}>✓ SIRET</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: T.cyan, fontWeight: 700 }}>Voir la fiche ›</span>
                </div>
                <div style={{ fontSize: 11, color: T.sub }}>
                  📍 {detail.city || 'MEL'}
                  {(() => {
                    const d = missionDistance(detail);
                    return d != null ? ` (à ${formatDistance(d)})` : '';
                  })()}{' '}
                  · {detail.scheduled_date}
                  {detail.start_time ? ` · ${detail.start_time.slice(0, 5)}` : ''} · {formatHours(detail.duration_minutes)}
                </div>
              </div>
              {detail.detail && <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.55, marginBottom: 13 }}>{detail.detail}</div>}
              <button
                onClick={() => postuler(detail)}
                style={{ width: '100%', background: detail.is_solidaire ? '#16a34a' : '#fff', color: detail.is_solidaire ? '#fff' : '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 900, cursor: 'pointer' }}
              >
                {detail.is_solidaire ? '🤝 Participer à la mission' : `Accepter — ${euros(detail.worker_rate_cents)}`}
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
                {(Object.entries(REPORT_MOTIFS) as [ReportMotif, string][]).map(([k, l]) => (
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
                  <button key={n} onClick={() => noterStructure(n)} style={{ flex: 1, padding: '12px 0', fontSize: 22, background: T.row, border: `1px solid ${T.cb}`, borderRadius: 10, cursor: 'pointer', color: '#f59e0b' }}>
                    ★
                  </button>
                ))}
              </div>
              <button onClick={() => setRatingFor(null)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: T.mu, padding: '4px 0' }}>
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

        {docKey && <DocModal dk={docKey} onClose={() => setDocKey(null)} />}
      </div>
    </div>
  );
}

function ProfilCard({
  fullName,
  ville,
  isMicro,
  bio,
  skills,
  onSave,
}: {
  fullName: string;
  ville: string;
  isMicro: boolean;
  bio: string;
  skills: string[];
  onSave: (updates: { full_name: string; is_micro_entrepreneur: boolean; bio: string | null; skills: string[] }) => Promise<void>;
}) {
  const [name, setName] = useState(fullName);
  const [micro, setMicro] = useState(isMicro);
  const [bioText, setBioText] = useState(bio);
  const [skillsText, setSkillsText] = useState(skills.join(', '));
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Nom complet</div>
      <input aria-label="Nom complet" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inp, marginBottom: 12 }} />
      {ville && <div style={{ fontSize: 11, color: T.mu, marginBottom: 12 }}>📍 {ville}</div>}
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
