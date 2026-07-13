import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { Stars } from '@/components/ui/Stars';
import { Fld } from '@/components/ui/Fld';
import { T, FONT, inp } from '@/components/ui/theme';
import { useAuth } from '@/features/auth/AuthContext';
import { hasFounderAccess } from '@/features/auth/authService';
import { hasRememberedFounderAccess, isFounderEmail } from '@/lib/founder';

const DEMO_SECONDS = 30;
const DEMO_KEY = 'urosi_internal_demo_seconds_v1';
const DEMO_SHARED_KEY = 'urosi_founder_demo_shared_v1';

type DemoRole = 'worker' | 'structure';
type WorkerTab = 'flux' | 'moi' | 'wallet';
type StructureTab = 'missions' | 'candidats' | 'habitues';
type StructureKind = 'pme' | 'asso';
type CandidateStatus = 'pending' | 'accepted' | 'rejected';

type DemoMission = {
  id: string;
  title: string;
  structure: string;
  amount: number;
  city: string;
  when: string;
  duration: string;
  rating: number;
  distance: string;
  solid?: boolean;
  desc: string;
};

type DemoCandidate = {
  id: string;
  missionId: string;
  name: string;
  city: string;
  note: number;
  missions: number;
  here: number;
  history: [string, string][];
  status: CandidateStatus;
};

type DemoSharedState = {
  publishedMissions: DemoMission[];
  candidates: DemoCandidate[];
  acceptedMissionIds: string[];
};

const workerMissions: DemoMission[] = [
  {
    id: 'm1',
    title: 'Renfort service midi',
    structure: 'Burger Nord',
    amount: 42,
    city: 'Lille',
    when: 'Aujourd’hui · 12h-15h',
    duration: '3 h',
    rating: 4.7,
    distance: '0,3 km',
    desc: 'Rush du midi, aide comptoir, salle propre et équipe déjà briefée.',
  },
  {
    id: 'm2',
    title: 'Runner événement',
    structure: 'Maison Event',
    amount: 88,
    city: 'Lille',
    when: 'Vendredi · 18h-23h',
    duration: '5 h',
    rating: 4.9,
    distance: '1,4 km',
    desc: 'Coordination légère, service plateau, renfort sur installation.',
  },
  {
    id: 'm3',
    title: 'Distribution de colis alimentaires',
    structure: 'Banque Alimentaire',
    amount: 0,
    city: 'Lille',
    when: 'Samedi · 10h-13h',
    duration: '3 h',
    rating: 4.8,
    distance: '1,2 km',
    solid: true,
    desc: 'Mission solidaire. Elle ne rémunère pas, mais enrichit le CV vivant.',
  },
  {
    id: 'm4',
    title: 'Aide installation',
    structure: 'Traiteur Halluin',
    amount: 55,
    city: 'Halluin',
    when: 'Samedi · 16h-20h',
    duration: '4 h',
    rating: 4.6,
    distance: '2,2 km',
    desc: 'Montage de salle, mise en place, rangement léger.',
  },
];

const structureSeed: Record<
  StructureKind,
  {
    name: string;
    type: string;
    verified: string;
    stats: [string, string][];
    missions: DemoMission[];
    candidates: DemoCandidate[];
    regulars: DemoCandidate[];
  }
> = {
  pme: {
    name: 'Burger Nord',
    type: 'PME · Restauration rapide',
    verified: '✓ Vérifiée',
    stats: [
      ['215', 'missions'],
      ['98 %', 'présence'],
      ['6 min', 'réponse'],
    ],
    missions: [
      workerMissions[0]!,
      {
        id: 'pm2',
        title: 'Don du sang',
        structure: 'Burger Nord',
        amount: 40,
        city: 'Tourcoing',
        when: 'Demain · 9h-12h',
        duration: '3 h',
        rating: 4.6,
        distance: '1,2 km',
        desc: 'Accueil, orientation du public, préparation rapide.',
      },
      {
        id: 'pm3',
        title: 'Préparation mariage',
        structure: 'Burger Nord',
        amount: 70,
        city: 'Lille',
        when: 'Samedi · 15h-20h',
        duration: '5 h',
        rating: 4.8,
        distance: '2,8 km',
        desc: 'Préparation, mise en place et fin de service.',
      },
    ],
    candidates: [
      {
        id: 'c1',
        missionId: 'm1',
        name: 'Yanis M.',
        city: 'Lille',
        note: 4.6,
        missions: 18,
        here: 3,
        status: 'pending',
        history: [
          ['Renfort midi', '12/04'],
          ['Runner soir', '05/04'],
        ],
      },
      {
        id: 'c2',
        missionId: 'pm2',
        name: 'Lina K.',
        city: 'Roubaix',
        note: 4.9,
        missions: 9,
        here: 2,
        status: 'pending',
        history: [
          ['Accueil public', '18/04'],
          ['Inventaire', '03/04'],
        ],
      },
      {
        id: 'c3',
        missionId: 'm1',
        name: 'Aïssa D.',
        city: 'Lille',
        note: 4.8,
        missions: 14,
        here: 1,
        status: 'accepted',
        history: [
          ['Service en salle', '22/04'],
          ['Préparation mariage', '10/04'],
        ],
      },
    ],
    regulars: [],
  },
  asso: {
    name: 'Banque Alimentaire',
    type: 'Association loi 1901 · ESS',
    verified: '✓ Vérifiée',
    stats: [
      ['74', 'missions'],
      ['97 %', 'présence'],
      ['10 min', 'réponse'],
    ],
    missions: [workerMissions[2]!],
    candidates: [
      {
        id: 'a1',
        missionId: 'm3',
        name: 'Awa S.',
        city: 'Lille',
        note: 4.8,
        missions: 11,
        here: 2,
        status: 'pending',
        history: [
          ['Collecte alimentaire', '15/04'],
          ['Accueil public', '02/04'],
        ],
      },
    ],
    regulars: [],
  },
};

function emptyDemoState(): DemoSharedState {
  return { publishedMissions: [], candidates: [], acceptedMissionIds: [] };
}

function readDemoState(): DemoSharedState {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEMO_SHARED_KEY) || '{}') as Partial<DemoSharedState>;
    return {
      publishedMissions: Array.isArray(parsed.publishedMissions) ? parsed.publishedMissions : [],
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      acceptedMissionIds: Array.isArray(parsed.acceptedMissionIds) ? parsed.acceptedMissionIds : [],
    };
  } catch {
    return emptyDemoState();
  }
}

function writeDemoState(state: DemoSharedState) {
  try {
    localStorage.setItem(DEMO_SHARED_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function uniqueMissions(missions: DemoMission[]) {
  const seen = new Set<string>();
  return missions.filter((mission) => {
    if (seen.has(mission.id)) return false;
    seen.add(mission.id);
    return true;
  });
}

function uniqueCandidates(candidates: DemoCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

function workerFeedMissions() {
  const shared = readDemoState().publishedMissions;
  return uniqueMissions([...shared, ...workerMissions]);
}

function structureMissions(kind: StructureKind) {
  const shared = readDemoState().publishedMissions;
  return uniqueMissions([...shared, ...structureSeed[kind].missions]);
}

function structureCandidates(kind: StructureKind) {
  const state = readDemoState();
  const visibleMissionIds = new Set(structureMissions(kind).map((mission) => mission.id));
  return uniqueCandidates([...state.candidates.filter((candidate) => visibleMissionIds.has(candidate.missionId)), ...structureSeed[kind].candidates]);
}

function rememberPublishedMission(mission: DemoMission, candidate: DemoCandidate) {
  const state = readDemoState();
  writeDemoState({
    ...state,
    publishedMissions: uniqueMissions([mission, ...state.publishedMissions]),
    candidates: uniqueCandidates([candidate, ...state.candidates]),
  });
}

function rememberAcceptedMission(missionId: string) {
  const state = readDemoState();
  if (state.acceptedMissionIds.includes(missionId)) return state.acceptedMissionIds;
  const acceptedMissionIds = [...state.acceptedMissionIds, missionId];
  writeDemoState({ ...state, acceptedMissionIds });
  return acceptedMissionIds;
}

function founderMission(type: 'paid' | 'solid'): DemoMission {
  const paid = type === 'paid';
  return {
    id: `founder-${type}-${Date.now()}`,
    title: paid ? 'Renfort service partenaire' : 'Distribution solidaire partenaire',
    structure: paid ? 'Burger Nord' : 'Banque Alimentaire',
    amount: paid ? 64 : 0,
    city: 'Lille',
    when: paid ? 'Demain · 12h-16h' : 'Samedi · 10h-13h',
    duration: paid ? '4 h' : '3 h',
    rating: paid ? 4.7 : 4.8,
    distance: 'démo',
    solid: !paid,
    desc: paid
      ? 'Mission payante créée en démo par la structure. Prix, places et horaires sont libres.'
      : 'Mission solidaire à 0 €. Elle compte dans le CV vivant sans rémunération.',
  };
}

function demoCandidateFor(mission: DemoMission): DemoCandidate {
  return {
    id: `cand-${mission.id}-${Date.now()}`,
    missionId: mission.id,
    name: mission.solid ? 'Awa S.' : 'Yanis M.',
    city: 'Lille',
    note: mission.solid ? 4.8 : 4.6,
    missions: mission.solid ? 11 : 18,
    here: mission.solid ? 2 : 3,
    status: 'pending',
    history: mission.solid ? [['Collecte alimentaire', '15/04'], ['Accueil public', '02/04']] : [['Renfort midi', '12/04'], ['Runner soir', '05/04']],
  };
}

function readNumber(key: string) {
  try {
    return Number(localStorage.getItem(key) || '0') || 0;
  } catch {
    return 0;
  }
}

function initials(name: string) {
  return name
    .split(' ')
    .map((x) => x.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function Button({
  children,
  onClick,
  tone = 'dark',
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'dark' | 'light' | 'green' | 'red' | 'ghost';
  disabled?: boolean;
}) {
  const styles = {
    dark: { background: '#fff', color: '#05060d', border: '1px solid #fff' },
    light: { background: T.row, color: T.text, border: `1px solid ${T.cb}` },
    green: { background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}` },
    red: { background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}` },
    ghost: { background: 'transparent', color: T.mu, border: `1px solid ${T.cb}` },
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles,
        width: '100%',
        borderRadius: 11,
        padding: '12px 14px',
        fontSize: 13,
        fontWeight: 900,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

function TopBar({
  title,
  badge,
  onBack,
  founder,
}: {
  title: string;
  badge?: string;
  onBack?: () => void;
  founder?: boolean;
}) {
  return (
    <div style={{ padding: '22px 20px 13px', borderBottom: `1px solid ${T.cb}`, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: T.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900 }}>U</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: T.text }}>{title}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {badge && <span style={{ fontSize: 9, fontWeight: 900, color: T.cyan, background: '#22d3ee15', borderRadius: 12, padding: '2px 8px' }}>{badge}</span>}
            <span style={{ fontSize: 9, fontWeight: 900, color: T.amber, background: T.amberBg, borderRadius: 12, padding: '2px 8px' }}>DÉMO</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
        {founder && <span style={{ fontSize: 10, color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 14, padding: '5px 10px', fontWeight: 900 }}>Accès fondateur</span>}
        {onBack && (
          <button onClick={onBack} style={{ background: T.row, color: T.sub, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '7px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
            ← Accueil
          </button>
        )}
      </div>
    </div>
  );
}

function DemoShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#000', color: T.text, fontFamily: FONT, display: 'flex', justifyContent: 'center', padding: '22px 14px' }}>
      <div style={{ width: '100%', maxWidth: 430, minHeight: 'calc(100vh - 44px)', background: T.bg, border: `1px solid ${T.cb}`, borderRadius: 32, overflow: 'hidden', boxShadow: '0 24px 90px rgba(0,0,0,.75)' }}>{children}</div>
    </div>
  );
}

function MissionCard({ mission, onAccept, onStructure }: { mission: DemoMission; onAccept?: () => void; onStructure?: () => void }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${mission.solid ? T.greenBorder : T.cb}`, borderRadius: 16, padding: 17 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        {mission.solid ? (
          <>
            <span style={{ color: T.green, fontSize: 27, fontWeight: 900, letterSpacing: -1 }}>Solidaire</span>
            <span style={{ color: T.sub, fontSize: 15, fontWeight: 900 }}>0 €</span>
          </>
        ) : (
          <span style={{ color: T.text, fontSize: 36, fontWeight: 900, letterSpacing: -2 }}>{mission.amount}€</span>
        )}
      </div>
      <div style={{ color: T.text, fontSize: 15, fontWeight: 900, marginBottom: 5 }}>{mission.title}</div>
      <button onClick={onStructure} style={{ background: 'none', border: 'none', color: T.sub, fontSize: 11, fontWeight: 800, padding: 0, cursor: 'pointer' }}>
        {mission.structure} ›
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 5 }}>
        <span style={{ color: T.green, background: T.greenBg, borderRadius: 12, padding: '2px 7px', fontSize: 8.5, fontWeight: 900 }}>✓ Vérifié</span>
        <Stars n={mission.rating} size={12} />
        <span style={{ color: T.mu, fontSize: 10, fontWeight: 800 }}>{mission.rating.toFixed(1).replace('.', ',')}</span>
      </div>
      <div style={{ color: T.mu, fontSize: 10.5, lineHeight: 1.5, marginTop: 7 }}>
        {mission.city} · {mission.when} · {mission.duration} · {mission.distance}
      </div>
      {mission.solid && <div style={{ color: T.green, fontSize: 11, fontWeight: 800, marginTop: 7 }}>Compte dans ton CV vivant · sans rémunération</div>}
      <div style={{ marginTop: 13 }}>
        <Button onClick={onAccept} tone={mission.solid ? 'green' : 'dark'}>
          {mission.solid ? 'Participer' : 'Accepter'}
        </Button>
      </div>
    </div>
  );
}

function StructureProfile({ name, onBack }: { name: string; onBack: () => void }) {
  const isAsso = name.includes('Alimentaire');
  const profile = isAsso ? structureSeed.asso : structureSeed.pme;
  return (
    <div style={{ minHeight: '100%', background: T.bg }}>
      <div style={{ height: 175, background: `linear-gradient(155deg, ${isAsso ? '#14532d' : '#172554'}, #05060d)`, position: 'relative', display: 'flex', alignItems: 'flex-end', padding: 20 }}>
        <button onClick={onBack} style={{ position: 'absolute', top: 16, left: 16, width: 38, height: 38, borderRadius: 19, background: 'rgba(0,0,0,.45)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 20 }}>‹</button>
        <div style={{ color: '#ffffff16', fontSize: 17, fontWeight: 900, letterSpacing: 3 }}>{profile.name.toUpperCase()}</div>
      </div>
      <div style={{ padding: '0 20px 24px', marginTop: -30 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 16 }}>
          <div style={{ width: 66, height: 66, borderRadius: 17, background: isAsso ? '#14532d' : '#075985', border: '2px solid rgba(255,255,255,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 20 }}>{initials(profile.name)}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{profile.name}</div>
              <span style={{ color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 12, padding: '2px 8px', fontSize: 9, fontWeight: 900 }}>{profile.verified}</span>
            </div>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 5 }}>
              <Stars n={isAsso ? 4.8 : 4.7} size={12} />
              <span style={{ color: T.text, fontSize: 12, fontWeight: 900 }}>{isAsso ? '4,8' : '4,7'}</span>
              <span style={{ color: T.mu, fontSize: 11 }}>({isAsso ? 61 : 38} avis)</span>
            </div>
          </div>
        </div>
        <span style={{ display: 'inline-flex', color: isAsso ? T.green : T.cyan, background: isAsso ? T.greenBg : '#22d3ee15', border: `1px solid ${isAsso ? T.greenBorder : '#0e7490'}`, borderRadius: 14, padding: '4px 10px', fontSize: 10, fontWeight: 900, marginBottom: 12 }}>{profile.type}</span>
        <div style={{ color: T.mu, fontSize: 11, marginBottom: 16 }}>SIRET {isAsso ? '421 987 654 00021' : '852 123 456 00018'} ⓘ</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: '15px 0', marginBottom: 16 }}>
          {profile.stats.map(([v, l], i) => (
            <div key={l} style={{ textAlign: 'center', borderRight: i < 2 ? `1px solid ${T.cb}` : 'none' }}>
              <div style={{ fontSize: 19, color: T.text, fontWeight: 900 }}>{v}</div>
              <div style={{ fontSize: 9, color: T.mu }}>{l}</div>
            </div>
          ))}
        </div>
        {['Rue Nationale, 59000 Lille', 'Métro Gambetta (300 m)', isAsso ? 'Créneaux solidaires en semaine' : 'Ouvert 11h-23h'].map((line) => (
          <div key={line} style={{ color: T.sub, fontSize: 12, marginBottom: 10 }}>{line}</div>
        ))}
        <div style={{ borderTop: `1px solid ${T.cb}`, paddingTop: 14, marginTop: 14 }}>
          <div style={{ color: T.text, fontSize: 14, fontWeight: 900, marginBottom: 8 }}>Photos du lieu</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ aspectRatio: '1.15', borderRadius: 10, background: `linear-gradient(155deg, ${isAsso ? '#14532d' : '#172554'}, #111827)` }} />
            ))}
          </div>
          <div style={{ color: T.cyan, fontSize: 11, fontWeight: 900 }}>Voir toutes les photos (8)</div>
        </div>
        <div style={{ marginTop: 20 }}>
          <div style={{ color: T.text, fontSize: 14, fontWeight: 900, marginBottom: 6 }}>À propos</div>
          <div style={{ color: T.sub, fontSize: 12, lineHeight: 1.6 }}>
            {isAsso ? "Association d'aide alimentaire. Missions bénévoles pour préparer et distribuer des colis aux familles." : 'Fast-food indépendant à Lille. Missions courtes, équipe jeune et process clair.'}
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkerDemo({ founder, onBack }: { founder: boolean; onBack: () => void }) {
  const [tab, setTab] = useState<WorkerTab>('flux');
  const [feed] = useState<DemoMission[]>(() => workerFeedMissions());
  const [accepted, setAccepted] = useState<string[]>(() => readDemoState().acceptedMissionIds);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [wallet, setWallet] = useState(182);
  const tr = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  function notif(m: string) {
    setToast(m);
    clearTimeout(tr.current);
    tr.current = setTimeout(() => setToast(null), 2600);
  }

  function accept(m: DemoMission) {
    if (!accepted.includes(m.id)) setAccepted(rememberAcceptedMission(m.id));
    setTab('moi');
    notif(m.solid ? 'Mission solidaire ajoutée à tes missions.' : 'Mission acceptée. QR de début prêt.');
  }

  const myMissions = feed.filter((m) => accepted.includes(m.id));
  const completed = 3 + accepted.length;
  const founderPublishedCount = feed.filter((m) => m.id.startsWith('founder-') || m.id.startsWith('new-')).length;

  if (profileName) return <StructureProfile name={profileName} onBack={() => setProfileName(null)} />;

  return (
    <>
      <TopBar title="Mon espace" badge={`${completed} missions au CV`} onBack={onBack} founder={founder} />
      {toast && <div style={{ margin: '10px 14px 0', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 10, padding: '8px 12px', color: T.sub, fontSize: 11 }}>{toast}</div>}
      <div style={{ padding: 16, minHeight: 620 }}>
        {tab === 'flux' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ color: T.mu, fontSize: 10, textAlign: 'center' }}>
              Flux trié autour de toi · compte fictif{founderPublishedCount ? ` · ${founderPublishedCount} mission${founderPublishedCount > 1 ? 's' : ''} lancée${founderPublishedCount > 1 ? 's' : ''} côté structure` : ''}
            </div>
            {feed.map((mission) => (
              <MissionCard key={mission.id} mission={mission} onAccept={() => accept(mission)} onStructure={() => setProfileName(mission.structure)} />
            ))}
          </div>
        )}
        {tab === 'moi' && (
          <div style={{ display: 'grid', gap: 12 }}>
            {myMissions.length === 0 ? (
              <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: '28px 18px', textAlign: 'center' }}>
                <div style={{ color: T.sub, fontSize: 12, marginBottom: 14 }}>Aucune mission en cours</div>
                <Button onClick={() => setTab('flux')}>Voir le flux →</Button>
              </div>
            ) : (
              myMissions.map((m) => (
                <div key={m.id} style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 16 }}>
                  <div style={{ color: T.text, fontSize: 15, fontWeight: 900 }}>{m.title}</div>
                  <div style={{ color: T.mu, fontSize: 11, marginTop: 3 }}>{m.structure} · {m.when}</div>
                  <div style={{ background: T.row, border: `1px solid ${T.greenBorder}`, borderRadius: 12, padding: 12, marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.sub }}>
                      <span>QR début</span>
                      <strong style={{ color: T.green }}>Prêt</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.sub, marginTop: 8 }}>
                      <span>QR fin</span>
                      <strong style={{ color: T.mu }}>Après le début</strong>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                    <Button tone="green" onClick={() => notif('QR de début affiché dans la vraie app.')}>QR début</Button>
                    <Button tone="light" onClick={() => notif('Retard transmis à la structure.')}>Retard</Button>
                  </div>
                </div>
              ))
            )}
            <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 15 }}>
                <div style={{ width: 52, height: 52, borderRadius: 15, background: 'linear-gradient(135deg,#f97316,#dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, fontWeight: 900 }}>A</div>
                <div>
                  <div style={{ color: T.text, fontSize: 16, fontWeight: 900 }}>Alex Démo</div>
                  <div style={{ color: T.mu, fontSize: 11 }}>Lille · CV vivant · compte fictif</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                <div style={{ background: T.row, borderRadius: 12, padding: 12, textAlign: 'center' }}><strong style={{ color: T.text, fontSize: 22 }}>{completed}</strong><div style={{ color: T.mu, fontSize: 9 }}>Missions prouvées</div></div>
                <div style={{ background: T.row, borderRadius: 12, padding: 12, textAlign: 'center' }}><strong style={{ color: T.text, fontSize: 22 }}>★ 4.7</strong><div style={{ color: T.mu, fontSize: 9 }}>Note moyenne</div></div>
              </div>
              <div style={{ color: T.mu, fontSize: 9, fontWeight: 900, textTransform: 'uppercase', marginBottom: 8 }}>Historique vérifié</div>
              {['Renfort fast-food · 40 €', 'Aide installation · 55 €', 'Préparation mariage · 70 €'].map((h) => {
                const [title, amount] = h.split(' · ');
                return (
                  <div key={h} style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${T.cb}`, padding: '9px 0', color: T.text, fontSize: 12, fontWeight: 800 }}>
                    <span>{title ?? h}</span>
                    <span style={{ color: T.mu }}>{amount ?? ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {tab === 'wallet' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ background: '#032e18', border: '1px solid #0f6b36', borderRadius: 16, padding: 20 }}>
              <div style={{ color: T.green, fontSize: 11, fontWeight: 900 }}>DISPONIBLE</div>
              <div style={{ color: '#fff', fontSize: 48, fontWeight: 900, letterSpacing: -2 }}>{wallet}<span style={{ color: T.green, fontSize: 22 }}>€</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', marginTop: 10 }}>
                <div style={{ color: T.green, fontSize: 13, fontWeight: 900 }}>En attente · virement J+3<br /><span style={{ fontSize: 27 }}>40 €</span></div>
                <button onClick={() => setWallet((x) => x + 40)} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 16px', fontWeight: 900, cursor: 'pointer' }}>Libérer</button>
              </div>
            </div>
            <Button onClick={() => setWallet(0)} disabled={wallet <= 0}>Retirer</Button>
            <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 16, color: T.sub, fontSize: 12, lineHeight: 1.6 }}>
              L’argent reste disponible. Les virements sont simulés ici, mais dans l’app réelle ils passent par le wallet sécurisé.
            </div>
          </div>
        )}
      </div>
      <BottomTabs
        tabs={[
          ['flux', 'Flux'],
          ['moi', 'Missions'],
          ['wallet', 'Wallet'],
        ]}
        current={tab}
        onChange={(v) => setTab(v as WorkerTab)}
      />
    </>
  );
}

function BottomTabs({ tabs, current, onChange }: { tabs: [string, string][]; current: string; onChange: (v: string) => void }) {
  return (
    <div style={{ borderTop: `1px solid ${T.cb}`, padding: '8px 12px 14px', display: 'grid', gridTemplateColumns: `repeat(${tabs.length}, 1fr)`, gap: 8, background: T.bg, position: 'sticky', bottom: 0 }}>
      {tabs.map(([key, label]) => (
        <button key={key} onClick={() => onChange(key)} style={{ background: current === key ? '#fff' : 'transparent', color: current === key ? '#05060d' : T.mu, border: 'none', borderRadius: 12, padding: '11px 0', cursor: 'pointer', fontSize: 12, fontWeight: 900 }}>
          {label}
        </button>
      ))}
    </div>
  );
}

function PublishDemoModal({
  isAsso,
  onClose,
  onPublish,
}: {
  isAsso: boolean;
  onClose: () => void;
  onPublish: (mission: DemoMission) => void;
}) {
  const [f, setF] = useState({ title: 'Renfort service du midi', place: 'Lille centre', hourly: isAsso ? 0 : 14, places: 2, duration: 3, days: 1, solid: isAsso });
  const workerAmount = f.solid ? 0 : f.hourly * f.duration * f.days;
  const ok = f.title.trim().length >= 2 && f.place.trim().length >= 2 && (f.solid || workerAmount > 0);
  const total = f.solid ? 0 : Math.round(workerAmount * f.places * 1.18);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.74)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto', background: T.card, borderRadius: '24px 24px 0 0', padding: '20px 18px 28px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 18, color: T.text, fontWeight: 900 }}>Nouvelle mission</div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 9, background: T.row, color: T.sub, border: 'none', cursor: 'pointer' }}>×</button>
        </div>
        <Fld label="Mission">
          <input value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} style={inp} />
        </Fld>
        <Fld label="Lieu">
          <input value={f.place} onChange={(e) => setF((x) => ({ ...x, place: e.target.value }))} style={inp} />
        </Fld>
        <Fld label="Type">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Button tone={f.solid ? 'light' : 'dark'} onClick={() => setF((x) => ({ ...x, solid: false, hourly: Math.max(10, x.hourly || 14) }))}>Payée</Button>
            <Button tone={f.solid ? 'green' : 'light'} onClick={() => setF((x) => ({ ...x, solid: true, hourly: 0 }))}>Association · 0 €</Button>
          </div>
        </Fld>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Fld label="€/h proposé">
            <Stepper value={f.solid ? 0 : f.hourly} min={10} max={60} step={1} disabled={f.solid} onChange={(hourly) => setF((x) => ({ ...x, hourly }))} suffix="€" />
          </Fld>
          <Fld label="Places">
            <Stepper value={f.places} min={1} max={12} step={1} onChange={(places) => setF((x) => ({ ...x, places }))} />
          </Fld>
        </div>
        <Fld label="Horaires">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, marginBottom: 8 }}>
            {[1, 2, 3, 4, 5].map((h) => (
              <button key={h} onClick={() => setF((x) => ({ ...x, duration: h }))} style={{ background: f.duration === h ? '#fff' : T.row, color: f.duration === h ? '#05060d' : T.sub, border: `1px solid ${f.duration === h ? '#fff' : T.cb}`, borderRadius: 16, padding: '9px 0', fontWeight: 900, cursor: 'pointer' }}>{h}h</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
            {[1, 2, 3].map((d) => (
              <button key={d} onClick={() => setF((x) => ({ ...x, days: d }))} style={{ background: f.days === d ? '#fff' : T.row, color: f.days === d ? '#05060d' : T.sub, border: `1px solid ${f.days === d ? '#fff' : T.cb}`, borderRadius: 16, padding: '9px 0', fontWeight: 900, cursor: 'pointer' }}>{d}j</button>
            ))}
          </div>
        </Fld>
        <div style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 13, marginBottom: 14 }}>
          <div style={{ color: T.mu, fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>
            {f.solid ? 'Mission bénévole : aucun coût.' : `${f.duration} h × ${f.days} jour${f.days > 1 ? 's' : ''} × ${f.hourly} €/h = ${workerAmount} € / personne`}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: T.sub, fontSize: 12, marginBottom: 6 }}>
            <span>{f.solid ? 'Mission solidaire' : `Rémunération x ${f.places}`}</span>
            <strong style={{ color: T.text }}>{f.solid ? '0 €' : `${workerAmount * f.places} €`}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: T.sub, fontSize: 12 }}>
            <span>Commission structure 18 %</span>
            <strong style={{ color: T.text }}>{f.solid ? '0 €' : `${total - workerAmount * f.places} €`}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: T.text, fontSize: 14, fontWeight: 900, borderTop: `1px solid ${T.cb}`, paddingTop: 9, marginTop: 9 }}>
            <span>Total wallet</span>
            <span>{total} €</span>
          </div>
        </div>
        <Button
          disabled={!ok}
          onClick={() =>
            onPublish({
              id: `new-${Date.now()}`,
              title: f.title.trim(),
              structure: isAsso || f.solid ? 'Banque Alimentaire' : 'Burger Nord',
              amount: workerAmount,
              city: f.place.trim(),
              when: f.days === 1 ? `Aujourd’hui · ${f.duration} h` : `${f.days} jours · ${f.duration} h/jour`,
              duration: `${f.duration * f.days} h`,
              rating: isAsso || f.solid ? 4.8 : 4.7,
              distance: 'démo',
              solid: f.solid,
              desc: f.solid ? 'Mission bénévole à 0 €. Elle enrichit le CV vivant.' : 'Mission publiée avec prix libre choisi par la structure.',
            })
          }
        >
          {f.solid ? 'Publier · Solidaire (0 €)' : `Publier · ${workerAmount} € / personne`}
        </Button>
      </div>
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  step,
  onChange,
  suffix = '',
  disabled = false,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.row, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 10, opacity: disabled ? 0.6 : 1 }}>
      <button disabled={disabled} onClick={() => onChange(Math.max(min, value - step))} style={{ width: 30, height: 30, borderRadius: 15, border: 'none', background: T.cb, color: T.text, fontWeight: 900, cursor: disabled ? 'not-allowed' : 'pointer' }}>−</button>
      <div style={{ flex: 1, textAlign: 'center', color: T.text, fontSize: 22, fontWeight: 900 }}>{value}{suffix}</div>
      <button disabled={disabled} onClick={() => onChange(Math.min(max, value + step))} style={{ width: 30, height: 30, borderRadius: 15, border: 'none', background: T.grad, color: '#fff', fontWeight: 900, cursor: disabled ? 'not-allowed' : 'pointer' }}>+</button>
    </div>
  );
}

function StructureDemo({ founder, onBack, onSwitchWorker }: { founder: boolean; onBack: () => void; onSwitchWorker: () => void }) {
  const [kind, setKind] = useState<StructureKind | null>('pme');
  const [tab, setTab] = useState<StructureTab>('missions');
  const [missions, setMissions] = useState<DemoMission[]>(() => structureMissions('pme'));
  const [candidates, setCandidates] = useState<DemoCandidate[]>(() => structureCandidates('pme'));
  const [panel, setPanel] = useState<DemoCandidate | null>(null);
  const [showPub, setShowPub] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const tr = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function notif(m: string) {
    setToast(m);
    clearTimeout(tr.current);
    tr.current = setTimeout(() => setToast(null), 2600);
  }

  function choose(next: StructureKind) {
    setKind(next);
    setMissions(structureMissions(next));
    setCandidates(structureCandidates(next));
    setTab('missions');
  }

  if (!kind) {
    return (
      <>
        <TopBar title="Espace structure" badge="Choix du compte" onBack={onBack} founder={founder} />
        <div style={{ padding: 18 }}>
          <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 18, padding: 18, marginBottom: 14 }}>
            <div style={{ fontSize: 18, color: T.text, fontWeight: 900, marginBottom: 7 }}>Découvre l’espace structure</div>
            <div style={{ color: T.sub, fontSize: 12, lineHeight: 1.6, marginBottom: 14 }}>Choisis un compte fictif, publie une mission, regarde les candidats et leurs CV vivants.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <Button tone="light" onClick={() => choose('pme')}>Burger Nord<br /><span style={{ color: T.cyan, fontSize: 10 }}>PME</span></Button>
              <Button tone="green" onClick={() => choose('asso')}>Banque Alimentaire<br /><span style={{ fontSize: 10 }}>Association</span></Button>
            </div>
          </div>
          <Link to="/inscription/structure" style={{ textDecoration: 'none' }}><Button>Créer mon compte structure →</Button></Link>
        </div>
      </>
    );
  }

  const seed = structureSeed[kind];
  const pending = candidates.filter((c) => c.status === 'pending');
  const regulars = candidates.filter((c) => c.here >= 2);

  function decide(id: string, status: CandidateStatus) {
    setCandidates((list) => list.map((c) => (c.id === id ? { ...c, status } : c)));
    setPanel((c) => (c && c.id === id ? { ...c, status } : c));
    notif(status === 'accepted' ? 'Candidat accepté. Il voit la mission confirmée.' : 'Candidat refusé sans pénalité.');
  }

  function refreshFromDemoState() {
    if (!kind) return;
    setMissions(structureMissions(kind));
    setCandidates(structureCandidates(kind));
  }

  function publishIntoDemo(mission: DemoMission) {
    const demoCandidate = demoCandidateFor(mission);
    rememberPublishedMission(mission, demoCandidate);
  }

  function publish(mission: DemoMission) {
    publishIntoDemo(mission);
    refreshFromDemoState();
    setShowPub(false);
    setTab('candidats');
    notif('Mission publiée dans la démo. Un candidat arrive.');
  }

  function launchFakeMission(type: 'paid' | 'solid') {
    publishIntoDemo(founderMission(type));
    refreshFromDemoState();
    setTab('missions');
    notif(type === 'paid' ? 'Mission payante lancée. Elle apparaît côté utilisateur.' : 'Mission solidaire lancée. Elle apparaît côté utilisateur.');
  }

  function launchFakePair() {
    publishIntoDemo(founderMission('paid'));
    publishIntoDemo(founderMission('solid'));
    refreshFromDemoState();
    setTab('missions');
    notif('Deux missions fake lancées : une payante et une solidaire.');
  }

  return (
    <>
      <TopBar title="Espace structure" badge={seed.name} onBack={onBack} founder={founder} />
      {toast && <div style={{ margin: '10px 14px 0', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 10, padding: '8px 12px', color: T.sub, fontSize: 11 }}>{toast}</div>}
      <div style={{ padding: 16, minHeight: 620 }}>
        <div style={{ background: T.card, border: `1px solid ${T.greenBorder}`, borderRadius: 16, padding: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: kind === 'asso' ? '#14532d' : '#075985', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900 }}>{initials(seed.name)}</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: T.text, fontSize: 16, fontWeight: 900 }}>{seed.name}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              <span style={{ color: T.green, background: T.greenBg, borderRadius: 11, padding: '2px 7px', fontSize: 9, fontWeight: 900 }}>{seed.verified}</span>
              <span style={{ color: kind === 'asso' ? T.green : T.cyan, background: kind === 'asso' ? T.greenBg : '#22d3ee15', borderRadius: 11, padding: '2px 7px', fontSize: 9, fontWeight: 900 }}>{seed.type}</span>
            </div>
          </div>
          <button onClick={() => setKind(null)} style={{ background: T.row, color: T.mu, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '7px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>Changer</button>
        </div>
        <BottomTabs
          tabs={[
            ['missions', `Missions ${missions.length}`],
            ['candidats', `Candidats ${pending.length}`],
            ['habitues', `Habitués ${regulars.length}`],
          ]}
          current={tab}
          onChange={(v) => setTab(v as StructureTab)}
        />
        <div style={{ height: 12 }} />
        {tab === 'missions' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <Button onClick={() => setShowPub(true)}>Publier une mission</Button>
            <Button tone="dark" onClick={launchFakePair}>Lancer 2 missions fake</Button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Button tone="light" onClick={() => launchFakeMission('paid')}>Lancer payante</Button>
              <Button tone="green" onClick={() => launchFakeMission('solid')}>Lancer solidaire</Button>
            </div>
            <Button tone="ghost" onClick={onSwitchWorker}>Voir côté utilisateur →</Button>
            {missions.map((m, i) => {
              const count = candidates.filter((c) => c.missionId === m.id && c.status === 'pending').length;
              return (
                <div key={m.id} style={{ background: T.card, border: `1px solid ${i === 0 ? '#0e7490' : T.cb}`, borderRadius: 16, padding: 15 }}>
                  {i === 0 && <div style={{ color: T.cyan, fontSize: 9, fontWeight: 900, marginBottom: 7, textTransform: 'uppercase' }}>Dernière mission publiée</div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ color: T.text, fontSize: 14, fontWeight: 900 }}>{m.title}</div>
                      <div style={{ color: T.mu, fontSize: 10, marginTop: 4 }}>{m.structure} · {m.city} · {m.when} · {m.duration}</div>
                      <div style={{ color: T.sub, fontSize: 10.5, marginTop: 5, lineHeight: 1.45 }}>{m.desc}</div>
                    </div>
                    <div style={{ color: m.solid ? T.green : T.text, fontSize: 18, fontWeight: 900 }}>{m.solid ? 'Solidaire' : `${m.amount} €`}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                    <span style={{ color: T.green, background: T.greenBg, borderRadius: 10, padding: '2px 8px', fontSize: 9, fontWeight: 900 }}>Active</span>
                    {count > 0 ? (
                      <button onClick={() => setTab('candidats')} style={{ color: T.cyan, background: '#22d3ee15', border: 'none', borderRadius: 10, padding: '3px 9px', fontSize: 10, fontWeight: 900, cursor: 'pointer' }}>
                        {count} candidat{count > 1 ? 's' : ''} →
                      </button>
                    ) : (
                      <span style={{ color: T.mu, fontSize: 10 }}>Aucun candidat</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {tab === 'candidats' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ color: T.sub, fontSize: 11, lineHeight: 1.5 }}>Tape un candidat pour voir son CV vivant, puis accepte ou refuse.</div>
            {candidates.map((c) => (
              <CandidateCard key={c.id} candidate={c} missionTitle={missions.find((m) => m.id === c.missionId)?.title ?? 'Mission'} onOpen={() => setPanel(c)} onDecide={decide} />
            ))}
          </div>
        )}
        {tab === 'habitues' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ color: T.sub, fontSize: 11, lineHeight: 1.5 }}>Les travailleurs qui reviennent régulièrement chez toi.</div>
            {regulars.map((c) => (
              <div key={c.id} style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 15, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 13, background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>{c.name.charAt(0)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: T.text, fontSize: 14, fontWeight: 900 }}>{c.name}</div>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 3 }}><Stars n={c.note} size={12} /><span style={{ color: T.mu, fontSize: 10 }}>{c.note}/5</span></div>
                </div>
                <div style={{ color: T.amber, fontSize: 22, fontWeight: 900 }}>{c.here}×<div style={{ color: T.mu, fontSize: 8, fontWeight: 700 }}>missions ici</div></div>
              </div>
            ))}
          </div>
        )}
      </div>
      {panel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 190 }} onClick={() => setPanel(null)}>
          <div style={{ width: '100%', maxWidth: 430, background: T.card, borderRadius: '24px 24px 0 0', padding: '20px 18px 28px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 13, alignItems: 'center', marginBottom: 15 }}>
              <div style={{ width: 52, height: 52, borderRadius: 16, background: '#c56f2e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20, fontWeight: 900 }}>{panel.name.charAt(0)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ color: T.text, fontSize: 18, fontWeight: 900 }}>{panel.name} <span style={{ color: T.amber, fontSize: 10 }}>★ Habitué · {panel.here}×</span></div>
                <div style={{ color: T.mu, fontSize: 11 }}>{panel.city} · candidat sur « {missions.find((m) => m.id === panel.missionId)?.title ?? 'Mission'} »</div>
              </div>
              <button onClick={() => setPanel(null)} style={{ background: 'none', border: 'none', color: T.mu, fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
              {[
                ['Missions', String(panel.missions)],
                ['Note', `${panel.note}/5`],
                ['Chez toi', `${panel.here}×`],
              ].map(([l, v]) => (
                <div key={l} style={{ background: T.row, borderRadius: 12, padding: 12, textAlign: 'center' }}>
                  <div style={{ color: T.text, fontSize: 20, fontWeight: 900 }}>{v}</div>
                  <div style={{ color: T.mu, fontSize: 9 }}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{ color: T.mu, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 8 }}>Historique vérifié (CV vivant)</div>
            {panel.history.map(([title, date]) => (
              <div key={title} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', color: T.text, fontSize: 12, fontWeight: 800 }}>
                <span>{title}</span>
                <span style={{ color: T.mu }}>{date}</span>
              </div>
            ))}
            {panel.status === 'pending' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginTop: 14 }}>
                <Button tone="green" onClick={() => decide(panel.id, 'accepted')}>Accepter</Button>
                <Button tone="red" onClick={() => decide(panel.id, 'rejected')}>Refuser</Button>
              </div>
            ) : (
              <div style={{ marginTop: 14, color: panel.status === 'accepted' ? T.green : T.red, textAlign: 'center', fontWeight: 900 }}>Décision : {panel.status === 'accepted' ? 'accepté' : 'refusé'}</div>
            )}
          </div>
        </div>
      )}
      {showPub && <PublishDemoModal isAsso={kind === 'asso'} onClose={() => setShowPub(false)} onPublish={publish} />}
    </>
  );
}

function CandidateCard({
  candidate,
  missionTitle,
  onOpen,
  onDecide,
}: {
  candidate: DemoCandidate;
  missionTitle: string;
  onOpen: () => void;
  onDecide: (id: string, status: CandidateStatus) => void;
}) {
  return (
    <div style={{ background: T.card, border: `1px solid ${candidate.status === 'accepted' ? T.greenBorder : candidate.status === 'rejected' ? T.redBorder : T.cb}`, borderRadius: 16, overflow: 'hidden' }}>
      <button onClick={onOpen} style={{ width: '100%', background: 'none', border: 'none', padding: 15, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer' }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: '#c56f2e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 900 }}>{candidate.name.charAt(0)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: T.text, fontSize: 14, fontWeight: 900 }}>{candidate.name} {candidate.here >= 2 && <span style={{ color: T.amber, fontSize: 9 }}>★ Habitué · {candidate.here}×</span>}</div>
          <div style={{ color: T.mu, fontSize: 10, marginTop: 3 }}>{missionTitle} · {candidate.city}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}><Stars n={candidate.note} size={11} /><span style={{ color: T.mu, fontSize: 10 }}>{candidate.note} · {candidate.missions} missions</span></div>
        </div>
        {candidate.status !== 'pending' && <span style={{ color: candidate.status === 'accepted' ? T.green : T.red, fontSize: 10, fontWeight: 900 }}>{candidate.status === 'accepted' ? 'accepté' : 'refusé'}</span>}
      </button>
      {candidate.status === 'pending' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 15px 15px' }}>
          <Button tone="green" onClick={() => onDecide(candidate.id, 'accepted')}>Accepter</Button>
          <Button tone="red" onClick={() => onDecide(candidate.id, 'rejected')}>Refuser</Button>
        </div>
      )}
    </div>
  );
}

function DemoLimitOverlay({ role }: { role: DemoRole }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,15,.86)', backdropFilter: 'blur(7px)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, fontFamily: FONT }}>
      <div style={{ width: '100%', maxWidth: 380, background: T.card, border: `1px solid ${T.cb}`, borderRadius: 20, padding: 24, textAlign: 'center' }}>
        <Logo sz={58} />
        <div style={{ color: T.text, fontSize: 19, fontWeight: 900, margin: '18px 0 7px' }}>Fin de l’aperçu gratuit</div>
        <div style={{ color: T.sub, fontSize: 12, lineHeight: 1.65, marginBottom: 18 }}>
          Crée ton compte ou connecte-toi pour continuer. L'accès fondateur se déverrouille automatiquement sur le compte autorisé.
        </div>
        <Link to={role === 'structure' ? '/inscription/structure' : '/inscription/travailleur'} style={{ textDecoration: 'none', display: 'block', marginBottom: 8 }}>
          <Button>Créer mon compte</Button>
        </Link>
        <Link to="/connexion" style={{ textDecoration: 'none', display: 'block', marginBottom: 16 }}>
          <Button tone="light">J’ai déjà un compte</Button>
        </Link>
      </div>
    </div>
  );
}

export function DemoExperience() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const initialRole = params.get('role') === 'structure' ? 'structure' : params.get('role') === 'worker' ? 'worker' : null;
  const [role, setRole] = useState<DemoRole | null>(initialRole);
  const [used, setUsed] = useState(() => readNumber(DEMO_KEY));
  const [demoVersion, setDemoVersion] = useState(0);
  const [founderByCode, setFounderByCode] = useState(() => hasRememberedFounderAccess(session?.user.id));
  const founder = isFounderEmail(session?.user.email) || founderByCode;
  const frozen = Boolean(role && !founder && used >= DEMO_SECONDS);
  const left = Math.max(0, DEMO_SECONDS - used);

  useEffect(() => {
    let alive = true;
    if (!session) {
      setFounderByCode(false);
      return undefined;
    }
    if (isFounderEmail(session.user.email) || hasRememberedFounderAccess(session.user.id)) {
      setFounderByCode(true);
      return undefined;
    }
    hasFounderAccess()
      .then((value) => {
        if (alive) setFounderByCode(value);
      })
      .catch(() => {
        if (alive) setFounderByCode(false);
      });
    return () => {
      alive = false;
    };
  }, [session]);

  useEffect(() => {
    if (!role || founder || frozen) return undefined;
    const id = window.setInterval(() => {
      setUsed((prev) => {
        const next = prev + 1;
        try {
          localStorage.setItem(DEMO_KEY, String(next));
        } catch {
          // ignore
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [role, founder, frozen]);

  function resetDemo() {
    try {
      localStorage.removeItem(DEMO_KEY);
      localStorage.removeItem(DEMO_SHARED_KEY);
    } catch {
      // ignore
    }
    setUsed(0);
    setDemoVersion((value) => value + 1);
  }

  if (!role) {
    return (
      <DemoShell>
        <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ width: '100%', textAlign: 'center' }}>
            <Logo sz={72} />
            <div style={{ color: T.text, fontSize: 25, fontWeight: 900, marginTop: 18 }}>Démo interne UROSI</div>
            <div style={{ color: T.sub, fontSize: 13, lineHeight: 1.6, margin: '8px auto 22px', maxWidth: 330 }}>Explore le parcours travailleur ou structure avec des données fictives.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <Button tone="light" onClick={() => setRole('worker')}>Travailleur</Button>
              <Button onClick={() => setRole('structure')}>Structure</Button>
            </div>
            <Link to="/acces" style={{ textDecoration: 'none', display: 'block', marginBottom: 16 }}><Button tone="ghost">Créer un compte</Button></Link>
            {founder ? (
              <button onClick={resetDemo} style={{ background: 'none', color: T.green, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 900 }}>Accès fondateur actif · réinitialiser</button>
            ) : (
              <div style={{ color: T.mu, fontSize: 11 }}>Aperçu gratuit : {left}s restantes</div>
            )}
          </div>
        </div>
      </DemoShell>
    );
  }

  return (
    <>
      {!founder && (
        <div style={{ position: 'fixed', top: 18, right: 18, zIndex: 450, background: left > 8 ? T.amberBg : T.redBg, color: left > 8 ? T.amber : T.red, border: `1px solid ${left > 8 ? T.amberBorder : T.redBorder}`, borderRadius: 18, padding: '7px 13px', fontFamily: FONT, fontSize: 12, fontWeight: 900 }}>
          Aperçu démo · {left}s
        </div>
      )}
      {founder && (
        <button onClick={resetDemo} style={{ position: 'fixed', top: 18, right: 18, zIndex: 450, background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}`, borderRadius: 18, padding: '7px 13px', fontFamily: FONT, fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>
          Accès fondateur
        </button>
      )}
      <DemoShell>
        {role === 'worker' ? (
          <WorkerDemo key={`worker-${demoVersion}`} founder={founder} onBack={() => setRole(null)} />
        ) : (
          <StructureDemo key={`structure-${demoVersion}`} founder={founder} onBack={() => setRole(null)} onSwitchWorker={() => setRole('worker')} />
        )}
      </DemoShell>
      {frozen && <DemoLimitOverlay role={role} />}
    </>
  );
}

export function SignupDemoPanel({ role }: { role: DemoRole }) {
  const isStructure = role === 'structure';
  return (
    <aside className="signup-demo-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ color: T.text, fontSize: 14, fontWeight: 900 }}>{isStructure ? 'Démo structure' : 'Démo travailleur'}</div>
          <div style={{ color: T.mu, fontSize: 10, marginTop: 2 }}>visible pendant l’inscription</div>
        </div>
        <span style={{ color: T.amber, background: T.amberBg, borderRadius: 12, padding: '3px 8px', fontSize: 9, fontWeight: 900 }}>DÉMO</span>
      </div>
      {isStructure ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ background: T.row, border: `1px solid ${T.greenBorder}`, borderRadius: 14, padding: 13 }}>
            <div style={{ color: T.text, fontSize: 13, fontWeight: 900 }}>Publier une mission</div>
            <div style={{ color: T.sub, fontSize: 11, marginTop: 4 }}>Prix libre, places, durée, association à 0 €.</div>
          </div>
          <div style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: T.text, fontSize: 13, fontWeight: 900 }}>
              <span>Yanis M.</span>
              <span style={{ color: T.amber }}>★ 4.6</span>
            </div>
            <div style={{ color: T.mu, fontSize: 10, marginTop: 4 }}>18 missions · CV vivant vérifié</div>
          </div>
          <Link to="/demo?role=structure" style={{ textDecoration: 'none' }}><Button>Ouvrir la démo structure</Button></Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 13 }}>
            <div style={{ color: T.text, fontSize: 28, fontWeight: 900 }}>42€</div>
            <div style={{ color: T.text, fontSize: 13, fontWeight: 900 }}>Renfort service midi</div>
            <div style={{ color: T.mu, fontSize: 10, marginTop: 4 }}>Burger Nord · 0,3 km · QR début/fin</div>
          </div>
          <div style={{ background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 14, padding: 13 }}>
            <div style={{ color: T.green, fontSize: 11, fontWeight: 900 }}>CV vivant +1</div>
            <div style={{ color: T.sub, fontSize: 10, marginTop: 4 }}>Chaque mission terminée devient une preuve.</div>
          </div>
          <Link to="/demo?role=worker" style={{ textDecoration: 'none' }}><Button>Ouvrir la démo travailleur</Button></Link>
        </div>
      )}
    </aside>
  );
}
