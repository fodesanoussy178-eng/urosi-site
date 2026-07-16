import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { Stars } from '@/components/ui/Stars';
import { Fld } from '@/components/ui/Fld';
import { QRBadge } from '@/components/ui/QRBadge';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { T, FONT, inp } from '@/components/ui/theme';
import { useAuth } from '@/features/auth/AuthContext';
import { hasFounderAccess } from '@/features/auth/authService';
import { findLocalLabAccount } from '@/features/founder/localLabAccounts';
import { hasDemoFounderAccess, hasRememberedFounderAccess, isDemoFounderCode, isFounderEmail, rememberDemoFounderAccess } from '@/lib/founder';

const DEMO_SECONDS = 60;
const DEMO_KEY = 'urosi_internal_demo_seconds_v1';
const DEMO_SHARED_KEY = 'urosi_founder_demo_shared_v1';
const DEMO_SERVICE_FEE_RATE = 0.18;
const DEMO_STRUCTURE_IDS = {
  pme: 'demo-structure-burger-nord',
  asso: 'demo-structure-banque-alimentaire',
} as const;
const DEMO_WORKER_HISTORY = [
  { label: 'Renfort service midi · 64 €', category: 'Restauration' },
  { label: 'Inventaire magasin · 42 €', category: 'Logistique' },
  { label: 'Montage festival · 91 €', category: 'Événementiel' },
  { label: 'Préparation commandes · 61 €', category: 'Logistique' },
  { label: 'Accueil au stade · 112 €', category: 'Événementiel' },
  { label: 'Installation forum étudiant · 44 €', category: 'Événementiel' },
  { label: 'Assistant tournage · 95 €', category: 'Événementiel' },
  { label: 'Accueil spectacle · 52 €', category: 'Événementiel' },
  { label: 'Classement bibliothèque · 39 €', category: 'Logistique' },
  { label: 'Accueil au musée · 78 €', category: 'Logistique' },
  { label: 'Livraison interne · 57 €', category: 'Logistique' },
  { label: 'Renfort association · Solidaire', category: 'Logistique' },
  { label: 'Aide photographe · 46 €', category: 'Événementiel' },
  { label: 'Mise en place événement · 73 €', category: 'Événementiel' },
  { label: 'Service en salle · 48 €', category: 'Restauration' },
] as const;

const DEMO_WORKER_CATEGORIES = Object.entries(
  DEMO_WORKER_HISTORY.reduce<Record<string, number>>((counts, mission) => {
    counts[mission.category] = (counts[mission.category] ?? 0) + 1;
    return counts;
  }, {}),
);

const DEMO_SHORTCUTS = [
  { label: 'Matin', start: '08:00', end: '12:00' },
  { label: 'Après-midi', start: '13:00', end: '17:00' },
  { label: 'Soir', start: '18:00', end: '23:00' },
  { label: 'Nuit', start: '22:00', end: '03:00' },
];

type DemoRole = 'worker' | 'structure';
type WorkerTab = 'flux' | 'moi' | 'wallet';
type StructureTab = 'missions' | 'candidats' | 'habitues' | 'historique';
type StructureKind = 'pme' | 'asso';
type CandidateStatus = 'pending' | 'accepted' | 'rejected';

type DemoMission = {
  id: string;
  structureId: string;
  title: string;
  structure: string;
  amount: number;
  city: string;
  when: string;
  duration: string;
  rating: number;
  reviews?: number;
  distance: string;
  solid?: boolean;
  desc: string;
  places?: number;
  status?: 'draft' | 'published';
};

type DemoCandidate = {
  id: string;
  missionId: string;
  name: string;
  city: string;
  note: number;
  here: number;
  history: [string, string][];
  status: CandidateStatus;
};

type DemoSharedState = {
  publishedMissions: DemoMission[];
  candidates: DemoCandidate[];
  acceptedMissionIds: string[];
  archivedMissionIds: string[];
  cancelledMissionIds: string[];
  cancellationReasons: Record<string, string>;
  deletedMissionIds: string[];
  missionAmounts: Record<string, number>;
  missionEdits: Record<string, Partial<Pick<DemoMission, 'title' | 'desc' | 'city' | 'when' | 'duration'>>>;
  startedMissionIds: string[];
  completedMissionIds: string[];
  workerUnreadMissionIds: string[];
  workerUnreadWalletMissionIds: string[];
  structureUnreadCandidateIds: string[];
  delayNotices: DemoDelayNotice[];
};

type DemoDelayNotice = {
  missionId: string;
  missionTitle: string;
  minutes: number;
};

type DemoMissionDay = {
  date: string;
  start: string;
  end: string;
};

const workerMissions: DemoMission[] = [
  {
    id: 'm1',
    structureId: DEMO_STRUCTURE_IDS.pme,
    title: 'Renfort service midi',
    structure: 'Burger Nord',
    amount: 64,
    city: 'Lille',
    when: 'Aujourd’hui · 8h30-11h30',
    duration: '3 h',
    rating: 4.8,
    reviews: 26,
    distance: '600 m',
    desc: 'Rush du midi, aide comptoir, salle propre et équipe déjà briefée.',
  },
  {
    id: 'm2',
    structureId: 'demo-structure-decathlon-lille',
    title: '📦 Inventaire magasin',
    structure: 'Décathlon Lille',
    amount: 42,
    city: 'Lille',
    when: 'Vendredi · 12h-15h',
    duration: '3 h',
    rating: 4.3,
    reviews: 41,
    distance: '1,2 km',
    desc: 'Comptage des rayons, contrôle des références et rangement léger.',
  },
  {
    id: 'm3',
    structureId: DEMO_STRUCTURE_IDS.asso,
    title: 'Distribution de colis alimentaires',
    structure: 'Banque Alimentaire',
    amount: 0,
    city: 'Lille',
    when: 'Samedi · 10h-13h',
    duration: '3 h',
    rating: 4.8,
    reviews: 18,
    distance: '2,1 km',
    solid: true,
    desc: 'Mission solidaire. Elle ne rémunère pas, mais enrichit le CV vivant.',
  },
  {
    id: 'm4',
    structureId: 'demo-structure-festival-lille',
    title: '🎪 Montage espace festival',
    structure: 'Festival de Lille',
    amount: 91,
    city: 'Lille',
    when: 'Samedi · 14h-19h',
    duration: '4 h',
    rating: 4.9,
    reviews: 63,
    distance: '1,8 km',
    desc: 'Installation des espaces, signalétique et accueil des exposants.',
  },
  {
    id: 'm5',
    structureId: 'demo-structure-mairie-lille',
    title: '📚 Classement bibliothèque',
    structure: 'Mairie de Lille',
    amount: 75,
    city: 'Lille',
    when: 'Lundi · 9h-14h',
    duration: '5 h',
    rating: 4.5,
    reviews: 34,
    distance: '900 m',
    desc: 'Retour des ouvrages, classement et orientation des visiteurs.',
  },
  {
    id: 'm6',
    structureId: 'demo-structure-stade-lille',
    title: '🏟 Accueil tribunes',
    structure: 'Stade Pierre-Mauroy',
    amount: 112,
    city: 'Villeneuve-d’Ascq',
    when: 'Samedi · 17h-23h',
    duration: '6 h',
    rating: 4.6,
    reviews: 87,
    distance: '5,4 km',
    desc: 'Orientation du public, contrôle des accès et assistance en tribune.',
  },
  {
    id: 'm7',
    structureId: 'demo-structure-loginord',
    title: '📦 Préparation commandes',
    structure: 'LogiNord',
    amount: 61,
    city: 'Lesquin',
    when: 'Mardi · 6h-10h',
    duration: '4 h',
    rating: 4.4,
    reviews: 29,
    distance: '7,2 km',
    desc: 'Préparation, étiquetage et mise en zone des commandes internes.',
  },
  {
    id: 'm8',
    structureId: 'demo-structure-universite-lille',
    title: '🎓 Installation forum étudiant',
    structure: 'Université de Lille',
    amount: 44,
    city: 'Lille',
    when: 'Mercredi · 8h-11h',
    duration: '3 h',
    rating: 4.7,
    reviews: 52,
    distance: '2,8 km',
    desc: 'Installation des stands, affichage et accueil des intervenants.',
  },
  {
    id: 'm9',
    structureId: 'demo-structure-studio-roubaix',
    title: '🎥 Assistant tournage',
    structure: 'Studio Roubaix',
    amount: 95,
    city: 'Roubaix',
    when: 'Jeudi · 13h-18h',
    duration: '5 h',
    rating: 5,
    reviews: 16,
    distance: '8,1 km',
    desc: 'Aide logistique, installation légère et coordination des arrivées.',
  },
  {
    id: 'm10',
    structureId: 'demo-structure-theatre-nord',
    title: '🎭 Accueil spectacle',
    structure: 'Théâtre du Nord',
    amount: 52,
    city: 'Lille',
    when: 'Vendredi · 18h-22h',
    duration: '4 h',
    rating: 4.2,
    reviews: 38,
    distance: '1,1 km',
    desc: 'Accueil, placement du public et accompagnement à la sortie.',
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
    verified: '✓ Vérifié (démo)',
    stats: [
      ['12', 'missions publiées'],
      ['94 %', 'acceptées'],
      ['★ 4,8', '21 avis'],
    ],
    missions: [
      workerMissions[0]!,
      {
        id: 'pm3',
        structureId: DEMO_STRUCTURE_IDS.pme,
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
        here: 3,
        status: 'pending',
        history: [
          ['Renfort midi', '12/04'],
          ['Runner soir', '05/04'],
        ],
      },
      {
        id: 'c3',
        missionId: 'm1',
        name: 'Aïssa D.',
        city: 'Lille',
        note: 4.8,
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
    verified: '✓ Vérifié (démo)',
    stats: [
      ['9', 'missions publiées'],
      ['97 %', 'acceptées'],
      ['★ 5,0', '15 avis'],
    ],
    missions: [workerMissions[2]!],
    candidates: [
      {
        id: 'a1',
        missionId: 'm3',
        name: 'Awa S.',
        city: 'Lille',
        note: 4.8,
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

const demoStructureHistory: Record<StructureKind, Array<{ date: string; title: string; address: string; amount: number }>> = {
  pme: [
    { date: '2026-07-10', title: 'Renfort service soir', address: '12 rue Nationale, Lille', amount: 76 },
    { date: '2026-07-08', title: 'Rush du midi', address: '12 rue Nationale, Lille', amount: 54 },
    { date: '2026-07-05', title: 'Préparation événement', address: '8 place Rihour, Lille', amount: 132 },
    { date: '2026-07-02', title: 'Renfort comptoir', address: '12 rue Nationale, Lille', amount: 61 },
    { date: '2026-06-28', title: 'Service du samedi', address: '12 rue Nationale, Lille', amount: 88 },
    { date: '2026-06-24', title: 'Inventaire cuisine', address: '12 rue Nationale, Lille', amount: 47 },
    { date: '2026-06-20', title: 'Renfort livraison', address: '4 rue de Béthune, Lille', amount: 69 },
  ],
  asso: [
    { date: '2026-07-11', title: 'Distribution alimentaire', address: '18 rue du Faubourg, Lille', amount: 0 },
    { date: '2026-07-04', title: 'Préparation des colis', address: '18 rue du Faubourg, Lille', amount: 0 },
    { date: '2026-06-27', title: 'Accueil des bénéficiaires', address: '18 rue du Faubourg, Lille', amount: 0 },
    { date: '2026-06-20', title: 'Collecte solidaire', address: '2 avenue de Dunkerque, Lomme', amount: 0 },
    { date: '2026-06-13', title: 'Tri des dons', address: '18 rue du Faubourg, Lille', amount: 0 },
    { date: '2026-06-06', title: 'Distribution du samedi', address: '18 rue du Faubourg, Lille', amount: 0 },
  ],
};

function downloadDemoHistory(kind: StructureKind) {
  const rows = demoStructureHistory[kind];
  const cell = (value: string | number) => {
    const text = String(value);
    const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replaceAll('"', '""')}"`;
  };
  const csv = `\uFEFFDate;Mission;Adresse;Dépense totale (€)\n${rows.map((row) => [row.date, row.title, row.address, row.amount.toFixed(2)].map(cell).join(';')).join('\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'urosi-demo-depenses.csv';
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function emptyDemoState(): DemoSharedState {
  return {
    publishedMissions: [],
    candidates: [],
    acceptedMissionIds: [],
    archivedMissionIds: [],
    cancelledMissionIds: [],
    cancellationReasons: {},
    deletedMissionIds: [],
    missionAmounts: {},
    missionEdits: {},
    startedMissionIds: [],
    completedMissionIds: [],
    workerUnreadMissionIds: [],
    workerUnreadWalletMissionIds: [],
    structureUnreadCandidateIds: [],
    delayNotices: [],
  };
}

function readDemoState(): DemoSharedState {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEMO_SHARED_KEY) || '{}') as Partial<DemoSharedState>;
    return {
      publishedMissions: Array.isArray(parsed.publishedMissions)
        ? parsed.publishedMissions.map((mission) => ({
            ...mission,
            structureId: mission.structureId ?? structureIdForName(mission.structure),
          }))
        : [],
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      acceptedMissionIds: Array.isArray(parsed.acceptedMissionIds) ? parsed.acceptedMissionIds : [],
      archivedMissionIds: Array.isArray(parsed.archivedMissionIds) ? parsed.archivedMissionIds : [],
      cancelledMissionIds: Array.isArray(parsed.cancelledMissionIds) ? parsed.cancelledMissionIds : [],
      cancellationReasons: parsed.cancellationReasons && typeof parsed.cancellationReasons === 'object' ? parsed.cancellationReasons : {},
      deletedMissionIds: Array.isArray(parsed.deletedMissionIds) ? parsed.deletedMissionIds : [],
      missionAmounts: parsed.missionAmounts && typeof parsed.missionAmounts === 'object' ? parsed.missionAmounts : {},
      missionEdits: parsed.missionEdits && typeof parsed.missionEdits === 'object' ? parsed.missionEdits : {},
      startedMissionIds: Array.isArray(parsed.startedMissionIds) ? parsed.startedMissionIds : [],
      completedMissionIds: Array.isArray(parsed.completedMissionIds) ? parsed.completedMissionIds : [],
      workerUnreadMissionIds: Array.isArray(parsed.workerUnreadMissionIds) ? parsed.workerUnreadMissionIds : [],
      workerUnreadWalletMissionIds: Array.isArray(parsed.workerUnreadWalletMissionIds) ? parsed.workerUnreadWalletMissionIds : [],
      structureUnreadCandidateIds: Array.isArray(parsed.structureUnreadCandidateIds) ? parsed.structureUnreadCandidateIds : [],
      delayNotices: Array.isArray(parsed.delayNotices) ? parsed.delayNotices : [],
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

function missionFingerprint(mission: DemoMission) {
  return [mission.structureId, mission.title, mission.city, mission.when, mission.duration, mission.amount]
    .map((value) => String(value).trim().toLocaleLowerCase('fr-FR'))
    .join('|');
}

function uniqueMissions(missions: DemoMission[]) {
  const seen = new Set<string>();
  return missions.filter((mission) => {
    const fingerprint = missionFingerprint(mission);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

function applyMissionState(mission: DemoMission, state: DemoSharedState): DemoMission {
  const amount = state.missionAmounts[mission.id];
  const edited = state.missionEdits[mission.id] ?? {};
  return {
    ...mission,
    ...edited,
    ...(typeof amount === 'number' && Number.isFinite(amount) ? { amount } : {}),
  };
}

function uniqueCandidates(candidates: DemoCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const workerKey = `${candidate.missionId}:${candidate.name.trim().toLocaleLowerCase('fr-FR')}`;
    if (seen.has(workerKey)) return false;
    seen.add(workerKey);
    return true;
  });
}

function uniqueCandidatePeople(candidates: DemoCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const workerKey = candidate.name.trim().toLocaleLowerCase('fr-FR');
    if (seen.has(workerKey)) return false;
    seen.add(workerKey);
    return true;
  });
}

function structureIdForName(name: string): string {
  if (name === structureSeed.pme.name) return DEMO_STRUCTURE_IDS.pme;
  if (name === structureSeed.asso.name) return DEMO_STRUCTURE_IDS.asso;
  return `demo-structure-${name.toLocaleLowerCase('fr-FR').replace(/[^a-z0-9]+/g, '-')}`;
}

function workerFeedMissions() {
  const state = readDemoState();
  const hidden = new Set([...state.archivedMissionIds, ...state.cancelledMissionIds, ...state.deletedMissionIds]);
  return uniqueMissions([...state.publishedMissions, ...workerMissions]
    .filter((mission) => !hidden.has(mission.id))
    .map((mission) => applyMissionState(mission, state)));
}

function structureMissions(kind: StructureKind) {
  const state = readDemoState();
  const structureId = DEMO_STRUCTURE_IDS[kind];
  const hidden = new Set([...state.archivedMissionIds, ...state.cancelledMissionIds, ...state.deletedMissionIds]);
  return uniqueMissions([
    ...state.publishedMissions.filter((mission) => mission.structureId === structureId),
    ...structureSeed[kind].missions.filter((mission) => mission.structureId === structureId),
  ].filter((mission) => !hidden.has(mission.id)).map((mission) => applyMissionState(mission, state)));
}

function archivedStructureMissions(kind: StructureKind) {
  const state = readDemoState();
  const structureId = DEMO_STRUCTURE_IDS[kind];
  const archived = new Set(state.archivedMissionIds);
  const deleted = new Set(state.deletedMissionIds);
  return uniqueMissions([
    ...state.publishedMissions,
    ...structureSeed[kind].missions,
  ].filter((mission) => mission.structureId === structureId && archived.has(mission.id) && !deleted.has(mission.id)).map((mission) => applyMissionState(mission, state)));
}

function cancelledStructureMissions(kind: StructureKind) {
  const state = readDemoState();
  const structureId = DEMO_STRUCTURE_IDS[kind];
  const cancelled = new Set(state.cancelledMissionIds);
  return uniqueMissions([
    ...state.publishedMissions,
    ...structureSeed[kind].missions,
  ].filter((mission) => mission.structureId === structureId && cancelled.has(mission.id)).map((mission) => applyMissionState(mission, state)));
}

function structureCandidates(kind: StructureKind) {
  const state = readDemoState();
  const visibleMissionIds = new Set(structureMissions(kind).map((mission) => mission.id));
  return uniqueCandidatePeople(uniqueCandidates([
    ...state.candidates.filter((candidate) => visibleMissionIds.has(candidate.missionId)),
    ...structureSeed[kind].candidates.filter((candidate) => visibleMissionIds.has(candidate.missionId)),
  ]));
}

function rememberPublishedMission(mission: DemoMission, candidate: DemoCandidate) {
  const state = readDemoState();
  writeDemoState({
    ...state,
    publishedMissions: uniqueMissions([mission, ...state.publishedMissions]),
    candidates: uniqueCandidates([candidate, ...state.candidates]),
  });
}

function rememberAcceptedMission(mission: DemoMission) {
  const state = readDemoState();
  const candidateId = `demo-worker-${mission.id}`;
  const alreadyApplied = state.acceptedMissionIds.includes(mission.id);
  const existingCandidate = state.candidates.find((candidate) => candidate.id === candidateId);
  const alreadyHasCandidate = Boolean(existingCandidate);
  const acceptedMissionIds = alreadyApplied ? state.acceptedMissionIds : [...state.acceptedMissionIds, mission.id];
  const candidate: DemoCandidate = {
    id: candidateId,
    missionId: mission.id,
    name: 'Alex Démo',
    city: 'Lille',
    note: 4.7,
    here: 1,
    status: 'pending',
    history: [['Renfort fast-food', '12/04'], ['Aide installation', '05/04'], ['Préparation mariage', '28/03']],
  };
  writeDemoState({
    ...state,
    acceptedMissionIds,
    candidates: uniqueCandidates([existingCandidate ?? candidate, ...state.candidates]),
    structureUnreadCandidateIds: alreadyHasCandidate ? state.structureUnreadCandidateIds : Array.from(new Set([...state.structureUnreadCandidateIds, candidate.id])),
  });
  return acceptedMissionIds;
}

function forgetAcceptedMission(missionId: string) {
  const state = readDemoState();
  const acceptedMissionIds = state.acceptedMissionIds.filter((id) => id !== missionId);
  const candidateId = `demo-worker-${missionId}`;
  writeDemoState({
    ...state,
    acceptedMissionIds,
    candidates: state.candidates.filter((candidate) => candidate.id !== candidateId),
    structureUnreadCandidateIds: state.structureUnreadCandidateIds.filter((id) => id !== candidateId),
    workerUnreadMissionIds: state.workerUnreadMissionIds.filter((id) => id !== missionId),
    delayNotices: state.delayNotices.filter((notice) => notice.missionId !== missionId),
  });
  return acceptedMissionIds;
}

function hideDemoMission(mission: DemoMission, action: 'archive' | 'delete') {
  const state = readDemoState();
  const allMissions = [...state.publishedMissions, ...workerMissions, ...structureSeed.pme.missions, ...structureSeed.asso.missions];
  const duplicateIds = Array.from(new Set(allMissions.filter((item) => missionFingerprint(applyMissionState(item, state)) === missionFingerprint(mission)).map((item) => item.id)));
  const hiddenIds = duplicateIds.length > 0 ? duplicateIds : [mission.id];
  const allCandidates = [...state.candidates, ...structureSeed.pme.candidates, ...structureSeed.asso.candidates];
  const candidateIds = allCandidates.filter((candidate) => hiddenIds.includes(candidate.missionId)).map((candidate) => candidate.id);
  if (action === 'archive') {
    writeDemoState({ ...state, archivedMissionIds: Array.from(new Set([...state.archivedMissionIds, ...hiddenIds])) });
    return true;
  }
  if (candidateIds.length > 0) return false;
  writeDemoState({
    ...state,
    archivedMissionIds: state.archivedMissionIds.filter((id) => !hiddenIds.includes(id)),
    deletedMissionIds: Array.from(new Set([...state.deletedMissionIds, ...hiddenIds])),
    acceptedMissionIds: state.acceptedMissionIds.filter((id) => !hiddenIds.includes(id)),
    candidates: state.candidates.filter((candidate) => !hiddenIds.includes(candidate.missionId)),
    structureUnreadCandidateIds: state.structureUnreadCandidateIds.filter((id) => !candidateIds.includes(id)),
    workerUnreadMissionIds: state.workerUnreadMissionIds.filter((id) => !hiddenIds.includes(id)),
    workerUnreadWalletMissionIds: state.workerUnreadWalletMissionIds.filter((id) => !hiddenIds.includes(id)),
    delayNotices: state.delayNotices.filter((notice) => !hiddenIds.includes(notice.missionId)),
  });
  return true;
}

function restoreDemoMission(mission: DemoMission) {
  const state = readDemoState();
  const allMissions = [...state.publishedMissions, ...workerMissions, ...structureSeed.pme.missions, ...structureSeed.asso.missions];
  const duplicateIds = allMissions.filter((item) => missionFingerprint(applyMissionState(item, state)) === missionFingerprint(mission)).map((item) => item.id);
  writeDemoState({ ...state, archivedMissionIds: state.archivedMissionIds.filter((id) => !duplicateIds.includes(id)) });
}

function updateDemoMissionAmount(missionId: string, amount: number) {
  const state = readDemoState();
  writeDemoState({ ...state, missionAmounts: { ...state.missionAmounts, [missionId]: Math.max(0, Math.round(amount)) } });
}

function updateDemoMissionDetails(missionId: string, patch: Partial<Pick<DemoMission, 'title' | 'desc' | 'city' | 'when' | 'duration'>>) {
  const state = readDemoState();
  writeDemoState({ ...state, missionEdits: { ...state.missionEdits, [missionId]: { ...(state.missionEdits[missionId] ?? {}), ...patch } } });
}

function cancelDemoMission(missionId: string, reason: string) {
  const state = readDemoState();
  writeDemoState({
    ...state,
    cancelledMissionIds: Array.from(new Set([...state.cancelledMissionIds, missionId])),
    cancellationReasons: { ...state.cancellationReasons, [missionId]: reason.trim() || 'Besoin annulé' },
  });
}

function duplicateDemoMission(mission: DemoMission) {
  const state = readDemoState();
  const copy: DemoMission = {
    ...mission,
    id: `copy-${Date.now()}`,
    title: `${mission.title} · copie`,
    when: 'Date et horaires à vérifier',
    status: 'draft',
  };
  writeDemoState({ ...state, publishedMissions: [copy, ...state.publishedMissions] });
}

function downloadDemoMissionRecap(mission: DemoMission) {
  const csv = `\uFEFFMission;Lieu;Horaires;Durée;Prix\n"${mission.title.replaceAll('"', '""')}";"${mission.city.replaceAll('"', '""')}";"${mission.when.replaceAll('"', '""')}";"${mission.duration.replaceAll('"', '""')}";${mission.amount}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `urosi-mission-${mission.id}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function rememberCandidateDecision(candidate: DemoCandidate, status: CandidateStatus) {
  const state = readDemoState();
  const updated = { ...candidate, status };
  const candidates = uniqueCandidates([updated, ...state.candidates.filter((item) => item.id !== candidate.id)]);
  writeDemoState({
    ...state,
    candidates,
    workerUnreadMissionIds: status === 'accepted' && candidate.id.startsWith('demo-worker-')
      ? Array.from(new Set([...state.workerUnreadMissionIds, candidate.missionId]))
      : state.workerUnreadMissionIds,
  });
}

function clearDemoUnread(field: 'workerUnreadMissionIds' | 'workerUnreadWalletMissionIds', ids: string[]) {
  const state = readDemoState();
  writeDemoState({ ...state, [field]: state[field].filter((id) => !ids.includes(id)) });
}

function rememberMissionScan(missionId: string, step: DemoQrStep) {
  const state = readDemoState();
  if (step === 'start') {
    writeDemoState({ ...state, startedMissionIds: Array.from(new Set([...state.startedMissionIds, missionId])) });
    return;
  }
  writeDemoState({
    ...state,
    completedMissionIds: Array.from(new Set([...state.completedMissionIds, missionId])),
    workerUnreadWalletMissionIds: state.completedMissionIds.includes(missionId)
      ? state.workerUnreadWalletMissionIds
      : Array.from(new Set([...state.workerUnreadWalletMissionIds, missionId])),
  });
}

function rememberDelayNotice(mission: DemoMission, minutes: number) {
  const state = readDemoState();
  const notice = { missionId: mission.id, missionTitle: mission.title, minutes };
  writeDemoState({ ...state, delayNotices: [notice, ...state.delayNotices.filter((item) => item.missionId !== mission.id)] });
}

function demoCandidateFor(mission: DemoMission): DemoCandidate {
  return {
    id: `cand-${mission.id}-${Date.now()}`,
    missionId: mission.id,
    name: mission.solid ? 'Awa S.' : 'Yanis M.',
    city: 'Lille',
    note: mission.solid ? 4.8 : 4.6,
    here: mission.solid ? 2 : 3,
    status: 'pending',
    history: mission.solid ? [['Collecte alimentaire', '15/04'], ['Accueil public', '02/04']] : [['Renfort midi', '12/04'], ['Runner soir', '05/04']],
  };
}

type DemoQrStep = 'start' | 'end';

function demoFounderScanUrl(mission: DemoMission, step: DemoQrStep): string {
  const query = new URLSearchParams({
    scan: 'founder',
    step,
    mission: mission.id,
    title: mission.title,
    structure: mission.structure,
  });
  return `${window.location.origin}/demo?${query.toString()}`;
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

function TopBar({ onBack }: {
  title: string;
  badge?: string;
  onBack?: () => void;
  founder?: boolean;
}) {
  return (
    <header style={{ height: 44, padding: '5px 12px', borderBottom: `1px solid ${T.cb}`, background: T.bg, display: 'grid', gridTemplateColumns: '40px 1fr 40px', alignItems: 'center', position: 'sticky', top: 0, zIndex: 170 }}>
      {onBack ? (
        <button aria-label="Revenir au choix de la démo" onClick={onBack} style={{ width: 38, height: 38, background: 'transparent', color: T.sub, border: 'none', borderRadius: 12, fontSize: 22, cursor: 'pointer' }}>‹</button>
      ) : <span />}
      <div style={{ display: 'grid', placeItems: 'center' }}><Logo sz={22} showWord={false} /></div>
      <div style={{ display: 'grid', placeItems: 'center' }}><ThemeToggle /></div>
    </header>
  );
}

function StructureStats({ stats, live = false }: { stats: [string, string][]; live?: boolean }) {
  return (
    <div aria-label="Statistiques de la structure" aria-live={live ? 'polite' : undefined} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7, marginBottom: 12 }}>
      {stats.map(([value, label]) => (
        <div key={label} style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 13, padding: '11px 7px', textAlign: 'center' }}>
          <div style={{ color: label.includes('avis') ? T.amber : T.text, fontSize: value.startsWith('★') ? 15 : 19, fontWeight: 900, lineHeight: 1.1 }}>{value}</div>
          <div style={{ color: T.mu, fontSize: 8.5, marginTop: 5, lineHeight: 1.2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

function DemoShell({ children, embedded = false }: { children: ReactNode; embedded?: boolean }) {
  return (
    <div style={{ minHeight: '100vh', background: embedded ? T.bg : '#000', color: T.text, fontFamily: FONT, display: 'flex', justifyContent: 'center', padding: embedded ? 0 : '22px 14px' }}>
      <div style={{ width: '100%', maxWidth: embedded ? 'none' : 430, minHeight: embedded ? '100vh' : 'calc(100vh - 44px)', background: T.bg, border: embedded ? 'none' : `1px solid ${T.cb}`, borderRadius: embedded ? 0 : 32, overflow: 'hidden', boxShadow: embedded ? 'none' : '0 24px 90px rgba(0,0,0,.75)' }}>{children}</div>
    </div>
  );
}

function MissionCard({ mission, onAccept, onStructure }: { mission: DemoMission; onAccept?: () => void; onStructure?: () => void }) {
  return (
    <div data-demo-tour="mission-card" style={{ background: T.card, border: `1px solid ${mission.solid ? T.greenBorder : T.cb}`, borderRadius: 16, padding: 17 }}>
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
        <span style={{ color: T.green, background: T.greenBg, borderRadius: 12, padding: '2px 7px', fontSize: 8.5, fontWeight: 900 }}>✓ Vérifié (démo)</span>
        <Stars n={mission.rating} size={12} animateOnce />
        <span style={{ color: T.mu, fontSize: 10, fontWeight: 800 }}>
          {mission.rating.toFixed(1).replace('.', ',')}{mission.reviews ? ` · ${mission.reviews} avis` : ''}
        </span>
      </div>
      <div style={{ color: T.mu, fontSize: 10.5, lineHeight: 1.5, marginTop: 7 }}>
        {mission.city} · {mission.when} · {mission.duration} · {mission.distance}
      </div>
      {mission.solid && <div style={{ color: T.green, fontSize: 11, fontWeight: 800, marginTop: 7 }}>Compte dans ton CV vivant · sans rémunération</div>}
      <div data-demo-tour="mission-action" style={{ marginTop: 13 }}>
        <Button onClick={onAccept} tone={mission.solid ? 'green' : 'dark'}>
          {mission.solid ? 'Participer' : 'Accepter'}
        </Button>
      </div>
    </div>
  );
}

type StructurePlacePhoto = {
  id: string;
  url: string;
  alt: string;
};

function StructurePlacePhotos({ photos }: { photos: StructurePlacePhoto[] }) {
  if (photos.length === 0) return null;

  return (
    <section style={{ borderTop: `1px solid ${T.cb}`, paddingTop: 14, marginTop: 14 }} aria-label="Photos du lieu">
      <div style={{ color: T.text, fontSize: 14, fontWeight: 900, marginBottom: 8 }}>Photos du lieu</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: photos.length > 4 ? 10 : 0 }}>
        {photos.slice(0, 4).map((photo) => (
          <img key={photo.id} src={photo.url} alt={photo.alt} loading="lazy" style={{ width: '100%', aspectRatio: '1.15', objectFit: 'cover', borderRadius: 10 }} />
        ))}
      </div>
      {photos.length > 4 && <button type="button" style={{ padding: 0, border: 0, background: 'none', color: T.cyan, fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>Voir toutes les photos ({photos.length})</button>}
    </section>
  );
}

const STRUCTURE_REVIEW_SAMPLES = [
  ['Mission bien organisée', 'Les horaires et les consignes étaient clairs dès le départ.'],
  ['Accueil professionnel', "L'équipe m'a intégré rapidement et le responsable était disponible."],
  ['Cadre fiable', 'La mission correspondait exactement à ce qui était annoncé.'],
  ['Communication simple', "J'ai reçu toutes les informations utiles avant mon arrivée."],
  ['Bonne expérience', 'Le déroulement était fluide du début à la fin.'],
] as const;

function StructureReviewList({ initialCount, total }: { initialCount: 2 | 3; total: number }) {
  const [expanded, setExpanded] = useState(false);
  const visibleReviews = STRUCTURE_REVIEW_SAMPLES.slice(0, expanded ? 5 : initialCount);

  return (
    <>
      <div style={{ display: 'grid', gap: 9 }}>
        {visibleReviews.map(([title, body]) => (
          <article key={title} style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 13, padding: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <strong style={{ color: T.text, fontSize: 11 }}>{title}</strong>
              <Stars n={5} size={10} />
            </div>
            <p style={{ color: T.sub, fontSize: 11, lineHeight: 1.5, margin: '7px 0 8px' }}>{body}</p>
            <span style={{ color: T.mu, fontSize: 9, fontWeight: 800 }}>Avis anonyme vérifié</span>
          </article>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        style={{ width: '100%', marginTop: 10, padding: '11px 12px', borderRadius: 11, border: `1px solid ${T.cb}`, background: 'transparent', color: T.text, fontSize: 11, fontWeight: 900, cursor: 'pointer' }}
      >
        {expanded ? 'Réduire les avis' : `Voir 5 avis sur ${total}`}
      </button>
    </>
  );
}

function StructureProfile({ name, onBack }: { name: string; onBack: () => void }) {
  const isAsso = name.includes('Alimentaire');
  const profile = isAsso ? structureSeed.asso : structureSeed.pme;
  // Temporairement vide. La galerie se réaffichera automatiquement dès que
  // les photos téléversées par la structure seront fournies ici.
  const placePhotos: StructurePlacePhoto[] = [];
  return (
    <div style={{ minHeight: '100%', background: T.bg }}>
      <div aria-label="En-tête du profil structure" style={{ height: 58, background: `linear-gradient(155deg, ${isAsso ? '#14532d' : '#172554'}, #05060d)`, position: 'relative' }}>
        <button aria-label="Retour aux missions" onClick={onBack} style={{ position: 'absolute', top: 12, left: 14, width: 38, height: 38, borderRadius: 19, background: 'rgba(0,0,0,.45)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 20 }}>‹</button>
      </div>
      <div style={{ padding: '12px 20px 24px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <div style={{ width: 50, height: 50, flexShrink: 0, borderRadius: 14, background: isAsso ? '#14532d' : '#075985', border: '2px solid rgba(255,255,255,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 17 }}>{initials(profile.name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 19, lineHeight: 1.15, fontWeight: 900, overflowWrap: 'anywhere' }}>{profile.name}</div>
              <span style={{ color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 12, padding: '2px 8px', fontSize: 9, fontWeight: 900 }}>{profile.verified}</span>
            </div>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 5 }}>
              <Stars n={isAsso ? 4.8 : 4.7} size={12} />
              <span style={{ color: T.text, fontSize: 12, fontWeight: 900 }}>{isAsso ? '4,8' : '4,7'}</span>
              <span style={{ color: T.mu, fontSize: 11 }}>(10 avis)</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, background: T.card, border: `1px solid ${T.greenBorder}`, borderRadius: 14, padding: '12px 14px', marginBottom: 18 }}>
          <div style={{ borderRight: `1px solid ${T.cb}`, paddingRight: 10 }}>
            <div style={{ color: T.text, fontSize: 16, fontWeight: 900 }}>12</div>
            <div style={{ color: T.sub, fontSize: 9.5, marginTop: 2 }}>missions réalisées</div>
          </div>
          <div style={{ paddingLeft: 12 }}>
            <div style={{ color: T.green, fontSize: 16, fontWeight: 900 }}>94 %</div>
            <div style={{ color: T.sub, fontSize: 9.5, marginTop: 2 }}>des missions réalisées</div>
          </div>
        </div>
        <div style={{ color: T.sub, fontSize: 12, marginBottom: 10 }}>📍 Rue Nationale, 59000 Lille</div>
        <div style={{ color: T.sub, fontSize: 12, marginBottom: 18 }}>Ⓜ Métro Gambetta · 300 m</div>
        <StructurePlacePhotos photos={placePhotos} />
        <section>
          <div style={{ color: T.text, fontSize: 14, fontWeight: 900, marginBottom: 6 }}>À propos</div>
          <div style={{ color: T.sub, fontSize: 12, lineHeight: 1.6 }}>
            {isAsso ? "Association d'aide alimentaire. Missions bénévoles pour préparer et distribuer des colis aux familles." : 'Fast-food indépendant à Lille. Missions courtes, équipe jeune et process clair.'}
          </div>
        </section>
        <details style={{ borderTop: `1px solid ${T.cb}`, borderBottom: `1px solid ${T.cb}`, marginTop: 18, padding: '13px 0' }}>
          <summary style={{ color: T.text, fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>Informations de la structure</summary>
          <div style={{ display: 'grid', gap: 8, marginTop: 12, color: T.sub, fontSize: 11 }}>
            <span>{profile.type}</span>
            <span>SIRET {isAsso ? '421 987 654 00021' : '852 123 456 00018'}</span>
            <span>{isAsso ? 'Créneaux solidaires en semaine' : 'Ouvert 11h-23h'}</span>
          </div>
        </details>
        <section aria-label="Avis sur la structure" style={{ marginTop: 20 }}>
          <div style={{ color: T.text, fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Avis</div>
          <StructureReviewList initialCount={isAsso ? 3 : 2} total={10} />
        </section>
        <div style={{ marginTop: 18 }}>
          <Button onClick={onBack}>Voir les missions disponibles</Button>
        </div>
      </div>
    </div>
  );
}

function WorkerDemo({ founder, onBack, accountName }: { founder: boolean; onBack: () => void; accountName?: string }) {
  const [tab, setTab] = useState<WorkerTab>('flux');
  const [feed, setFeed] = useState<DemoMission[]>(() => workerFeedMissions());
  const [demoState, setDemoState] = useState<DemoSharedState>(() => readDemoState());
  const [accepted, setAccepted] = useState<string[]>(() => readDemoState().acceptedMissionIds);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [wallet, setWallet] = useState(182);
  const [showEarnings, setShowEarnings] = useState(true);
  const [withdrawAmount, setWithdrawAmount] = useState(50);
  const [missionAlert, setMissionAlert] = useState<{ mission: DemoMission; type: 'delay' | 'cancel' } | null>(null);
  const [demoQr, setDemoQr] = useState<{ mission: DemoMission; step: DemoQrStep } | null>(null);
  const tr = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    function refresh(event: StorageEvent) {
      if (event.key !== DEMO_SHARED_KEY) return;
      const next = readDemoState();
      setDemoState(next);
      setAccepted(next.acceptedMissionIds);
      setFeed(workerFeedMissions());
    }
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);

  function notif(m: string) {
    setToast(m);
    clearTimeout(tr.current);
    tr.current = setTimeout(() => setToast(null), 2600);
  }

  function accept(m: DemoMission) {
    if (!accepted.includes(m.id)) setAccepted(rememberAcceptedMission(m));
    setDemoState(readDemoState());
    setTab('moi');
    notif(m.solid ? 'Candidature solidaire envoyée à la structure.' : `Candidature envoyée à ${m.structure}. En attente de son acceptation.`);
  }

  function withdraw() {
    if (!Number.isFinite(withdrawAmount)) return;
    const amount = Math.min(availableWallet, Math.max(1, Math.floor(withdrawAmount)));
    if (amount <= 0) return;
    setWallet((value) => value - amount);
    setWithdrawAmount(Math.max(1, availableWallet - amount));
    notif(`Retrait de ${amount} € demandé.`);
  }

  function cancelMission(mission: DemoMission) {
    setAccepted(forgetAcceptedMission(mission.id));
    setDemoState(readDemoState());
    setMissionAlert(null);
    notif(`Mission « ${mission.title} » annulée. La structure est prévenue.`);
  }

  const myMissions = feed.filter((m) => accepted.includes(m.id));
  const completed = DEMO_WORKER_HISTORY.length;
  const founderPublishedCount = feed.filter((m) => m.id.startsWith('founder-') || m.id.startsWith('new-')).length;
  const founderScanUrl = demoQr ? demoFounderScanUrl(demoQr.mission, demoQr.step) : '';
  const missionUnread = demoState.workerUnreadMissionIds.length;
  const walletUnread = demoState.workerUnreadWalletMissionIds.length;
  const completedIncome = demoState.completedMissionIds.reduce((sum, missionId) => sum + (feed.find((mission) => mission.id === missionId)?.amount ?? 0), 0);
  const availableWallet = Math.max(0, wallet + completedIncome);

  function changeWorkerTab(next: WorkerTab) {
    setTab(next);
    if (next === 'moi' && missionUnread > 0) {
      const acceptedStructure = feed.find((mission) => demoState.workerUnreadMissionIds.includes(mission.id))?.structure ?? 'La structure';
      notif(`+${missionUnread} · ${acceptedStructure} a accepté ta candidature.`);
      clearDemoUnread('workerUnreadMissionIds', demoState.workerUnreadMissionIds);
      setDemoState(readDemoState());
    }
    if (next === 'wallet' && walletUnread > 0) {
      notif(`+${walletUnread} · ${walletUnread} mission${walletUnread > 1 ? 's' : ''} terminée${walletUnread > 1 ? 's' : ''}, paiement ajouté au wallet.`);
      clearDemoUnread('workerUnreadWalletMissionIds', demoState.workerUnreadWalletMissionIds);
      setDemoState(readDemoState());
    }
  }

  if (profileName) return <StructureProfile name={profileName} onBack={() => setProfileName(null)} />;

  return (
    <>
      <TopBar title="Mon espace" badge={`${completed} missions au CV`} onBack={onBack} founder={founder} />
      {toast && <div style={{ margin: '10px 14px 0', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 10, padding: '8px 12px', color: T.sub, fontSize: 11 }}>{toast}</div>}
      <div style={{ padding: 16, paddingBottom: 92, minHeight: 620 }}>
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
              myMissions.map((m) => {
                const application = demoState.candidates.find((candidate) => candidate.id === `demo-worker-${m.id}`);
                const confirmed = application?.status === 'accepted';
                return (
                <div key={m.id} style={{ background: T.card, border: `1px solid ${confirmed ? T.greenBorder : T.cb}`, borderRadius: 16, padding: 16 }}>
                  <div style={{ color: T.text, fontSize: 15, fontWeight: 900 }}>{m.title}</div>
                  <div style={{ color: T.mu, fontSize: 11, marginTop: 3 }}>{m.structure} · {m.when}</div>
                  {!confirmed ? (
                    <div style={{ color: application?.status === 'rejected' ? T.red : T.amber, background: application?.status === 'rejected' ? T.redBg : T.amberBg, border: `1px solid ${application?.status === 'rejected' ? T.redBorder : T.amberBorder}`, borderRadius: 12, padding: 12, marginTop: 12, fontSize: 11, fontWeight: 900 }}>
                      {application?.status === 'rejected' ? 'Candidature non retenue' : 'Candidature en attente de la structure'}
                    </div>
                  ) : (<>
                  <div style={{ background: T.row, border: `1px solid ${T.greenBorder}`, borderRadius: 12, padding: 12, marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.sub }}>
                      <span>QR début</span>
                      <strong style={{ color: T.green }}>Prêt</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.sub, marginTop: 8 }}>
                      <span>QR fin</span>
                      <strong style={{ color: T.cyan }}>Disponible en démo</strong>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 10 }}>
                    <Button tone="green" onClick={() => setDemoQr({ mission: m, step: 'start' })}>QR début</Button>
                    <Button onClick={() => setDemoQr({ mission: m, step: 'end' })}>QR fin</Button>
                    <Button tone="light" onClick={() => setMissionAlert({ mission: m, type: 'delay' })}>Retard</Button>
                    <Button tone="red" onClick={() => setMissionAlert({ mission: m, type: 'cancel' })}>Annuler</Button>
                  </div>
                  </>)}
                </div>
              );})
            )}
            <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 15 }}>
                <div style={{ width: 52, height: 52, borderRadius: 15, background: 'linear-gradient(135deg,#f97316,#dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, fontWeight: 900 }}>A</div>
                <div>
                  <div style={{ color: T.text, fontSize: 16, fontWeight: 900, overflowWrap: 'anywhere' }}>{accountName ?? 'Alex Démo'}</div>
                  <div style={{ color: T.mu, fontSize: 11 }}>Lille · CV vivant · compte fictif</div>
                </div>
              </div>
              <div style={{ color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 12, padding: '10px 12px', fontSize: 10.5, fontWeight: 900, marginBottom: 10 }}>
                ✓ Compte et identité vérifiés (démo)
              </div>
              <div style={{ color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 12, padding: '10px 12px', fontSize: 11, fontWeight: 900, marginBottom: 10 }}>
                Disponible demain
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                <div style={{ background: T.row, borderRadius: 12, padding: 12, textAlign: 'center' }}><strong style={{ color: T.text, fontSize: 22 }}>{completed}</strong><div style={{ color: T.mu, fontSize: 9 }}>Missions prouvées</div></div>
                <div style={{ background: T.row, borderRadius: 12, padding: 12, textAlign: 'center' }}><strong style={{ color: T.text, fontSize: 22 }}>★ 4,7</strong><div style={{ color: T.mu, fontSize: 9 }}>Note moyenne</div></div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {DEMO_WORKER_CATEGORIES.map(([category, count]) => <span key={category} style={{ color: T.cyan, background: '#22d3ee12', border: `1px solid ${T.cb}`, borderRadius: 999, padding: '5px 8px', fontSize: 9.5, fontWeight: 900 }}>{category} · {count}</span>)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                <div style={{ color: T.mu, fontSize: 9, fontWeight: 900, textTransform: 'uppercase' }}>Historique vérifié</div>
                <button type="button" onClick={() => setShowEarnings((visible) => !visible)} aria-label={showEarnings ? 'Masquer les gains' : 'Afficher les gains'} style={{ background: T.row, color: T.cyan, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '5px 8px', fontSize: 9, fontWeight: 900, cursor: 'pointer' }}>{showEarnings ? 'Masquer' : 'Afficher'}</button>
              </div>
              {DEMO_WORKER_HISTORY.slice(0, 5).map((mission) => {
                const [title, amount] = mission.label.split(' · ');
                return (
                  <div key={mission.label} style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${T.cb}`, padding: '9px 0', color: T.text, fontSize: 12, fontWeight: 800 }}>
                    <span>{title ?? mission.label}</span>
                    <span style={{ color: T.mu }}>{showEarnings ? (amount ?? '') : '•••'}</span>
                  </div>
                );
              })}
              <div style={{ borderTop: `1px solid ${T.cb}`, paddingTop: 10, color: T.cyan, fontSize: 10, fontWeight: 900 }}>+ {completed - 5} autres missions vérifiées</div>
            </div>
          </div>
        )}
        {tab === 'wallet' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ background: '#032e18', border: '1px solid #0f6b36', borderRadius: 16, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ color: T.green, fontSize: 11, fontWeight: 900 }}>DISPONIBLE</div>
                <button type="button" onClick={() => setShowEarnings((visible) => !visible)} aria-label={showEarnings ? 'Masquer le solde' : 'Afficher le solde'} style={{ background: '#ffffff12', color: '#fff', border: '1px solid #ffffff25', borderRadius: 9, padding: '6px 9px', fontSize: 9.5, fontWeight: 900, cursor: 'pointer' }}>{showEarnings ? 'Masquer' : 'Afficher'}</button>
              </div>
              <div style={{ color: '#fff', fontSize: 48, fontWeight: 900, letterSpacing: -2 }}>{showEarnings ? availableWallet : '•••'}{showEarnings && <span style={{ color: T.green, fontSize: 22 }}>€</span>}</div>
              <div style={{ marginTop: 10 }}>
                <div style={{ color: T.green, fontSize: 13, fontWeight: 900 }}>En attente · virement J+3<br /><span style={{ fontSize: 27 }}>{showEarnings ? '40 €' : '•••'}</span></div>
              </div>
            </div>
            <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 16 }}>
              <label htmlFor="demo-withdraw-amount" style={{ display: 'block', color: T.sub, fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Montant à retirer</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                <input
                  id="demo-withdraw-amount"
                  aria-label="Montant à retirer"
                  type="number"
                  min={1}
                  max={availableWallet}
                  value={withdrawAmount}
                  onChange={(event) => {
                    const nextAmount = Number(event.target.value);
                    setWithdrawAmount(Number.isFinite(nextAmount) ? Math.min(availableWallet, Math.max(0, nextAmount)) : 0);
                  }}
                  style={{ ...inp, marginBottom: 0 }}
                />
                <Button onClick={withdraw} disabled={availableWallet <= 0 || !Number.isFinite(withdrawAmount) || withdrawAmount <= 0}>Retirer</Button>
              </div>
              <div style={{ color: T.mu, fontSize: 10, marginTop: 8 }}>Maximum disponible : {availableWallet} €</div>
            </div>
            <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 16, color: T.sub, fontSize: 12, lineHeight: 1.6 }}>
              L’argent reste disponible. Les virements sont simulés ici, mais dans l’app réelle ils passent par le wallet sécurisé.
            </div>
            <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 16 }}>
              <div style={{ color: T.text, fontSize: 13, fontWeight: 900, marginBottom: 10 }}>Compte sécurisé</div>
              {['IBAN vérifié', 'Carte d’identité vérifiée', 'Compte vérifié'].map((label) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${T.cb}`, padding: '10px 0', color: T.sub, fontSize: 11, fontWeight: 800 }}>
                  <span aria-hidden="true" style={{ color: T.green, fontWeight: 900 }}>✓</span>{label}
                </div>
              ))}
            </div>
            <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 16 }}>
              <div style={{ color: T.text, fontSize: 13, fontWeight: 900 }}>Historique des virements</div>
              <div style={{ color: T.mu, fontSize: 9.5, margin: '3px 0 8px' }}>Les montants et dates sont fictifs dans la démo.</div>
              {[
                ['Prochain versement · J+3', '+ 40 €', T.green],
                ['Retrait effectué · 11 juillet', '− 50 €', T.text],
                ['Festival de Lille · 9 juillet', '+ 91 €', T.green],
                ['Inventaire magasin · 6 juillet', '+ 42 €', T.green],
              ].map(([label, amount, color]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: `1px solid ${T.cb}`, padding: '10px 0', fontSize: 10.5 }}>
                  <span style={{ color: T.sub }}>{label}</span>
                  <strong style={{ color, whiteSpace: 'nowrap' }}>{showEarnings ? amount : '•••'}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {demoQr && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`QR fictif de ${demoQr.step === 'start' ? 'début' : 'fin'} de mission`}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 195, padding: 18 }}
          onClick={() => setDemoQr(null)}
        >
          <div style={{ width: '100%', maxWidth: 350, background: T.card, border: `1px solid ${T.cb}`, borderRadius: 22, padding: 22, textAlign: 'center' }} onClick={(event) => event.stopPropagation()}>
            <div style={{ color: T.text, fontSize: 18, fontWeight: 900 }}>QR de {demoQr.step === 'start' ? 'début' : 'fin'} · Démo</div>
            <div style={{ color: T.sub, fontSize: 11, lineHeight: 1.5, margin: '6px 0 16px' }}>
              {demoQr.mission.title}<br />{demoQr.mission.structure}
            </div>
            <div style={{ display: 'inline-flex', background: '#fff', padding: 10, borderRadius: 12 }}>
              <QRBadge value={founderScanUrl} size={190} />
            </div>
            <div style={{ color: T.amber, background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 10, padding: 10, fontSize: 10.5, lineHeight: 1.45, margin: '16px 0 12px' }}>
              Scanne avec ton téléphone, saisis le code fondateur puis {demoQr.step === 'start' ? 'active' : 'termine'} cette mission en simulation.
            </div>
            <div style={{ color: T.mu, fontSize: 10, marginBottom: 14 }}>Valable 10 minutes dans la simulation</div>
            <a href={founderScanUrl} target="_blank" rel="noreferrer" style={{ display: 'block', color: T.cyan, border: `1px solid ${T.cb}`, borderRadius: 11, padding: '11px 14px', marginBottom: 9, textDecoration: 'none', fontSize: 12, fontWeight: 900 }}>
              Tester sans scanner ↗
            </a>
            <Button tone="light" onClick={() => setDemoQr(null)}>Fermer</Button>
          </div>
        </div>
      )}
      {missionAlert && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 190 }} onClick={() => setMissionAlert(null)}>
          <div style={{ width: '100%', maxWidth: 430, background: T.card, borderRadius: '24px 24px 0 0', padding: '20px 18px 28px' }} onClick={(event) => event.stopPropagation()}>
            <div style={{ color: missionAlert.type === 'delay' ? T.amber : T.red, fontSize: 16, fontWeight: 900, marginBottom: 6 }}>
              {missionAlert.type === 'delay' ? 'Signaler un retard' : 'Annuler la mission'}
            </div>
            <div style={{ color: T.sub, fontSize: 11, lineHeight: 1.5, marginBottom: 14 }}>
              La structure sera prévenue immédiatement.
            </div>
            {missionAlert.type === 'delay' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7 }}>
                {[5, 10, 15, 30].map((minutes) => (
                  <button
                    key={minutes}
                    onClick={() => {
                      rememberDelayNotice(missionAlert.mission, minutes);
                      setDemoState(readDemoState());
                      notif(`Retard de ${minutes}${minutes === 30 ? ' minutes ou plus' : ' minutes'} transmis à la structure.`);
                      setMissionAlert(null);
                    }}
                    style={{ background: T.row, color: T.text, border: `1px solid ${T.cb}`, borderRadius: 9, padding: '11px 0', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                  >
                    {minutes} min{minutes === 30 ? '+' : ''}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Button tone="light" onClick={() => setMissionAlert(null)}>Revenir</Button>
                <Button tone="red" onClick={() => cancelMission(missionAlert.mission)}>Confirmer l’annulation</Button>
              </div>
            )}
          </div>
        </div>
      )}
      <BottomTabs
        tabs={[
          ['flux', 'Flux', '⌁'],
          ['moi', 'Missions', '🌳', missionUnread],
          ['wallet', 'Banque', '🏦', walletUnread],
        ]}
        current={tab}
        onChange={(v) => changeWorkerTab(v as WorkerTab)}
      />
    </>
  );
}

function BottomTabs({ tabs, current, onChange }: { tabs: [string, string, string?, number?][]; current: string; onChange: (v: string) => void }) {
  return (
    <nav aria-label="Navigation de la démo" style={{ width: '100%', maxWidth: 430, borderTop: `1px solid ${T.cb}`, padding: '8px 10px 10px', display: 'grid', gridTemplateColumns: `repeat(${tabs.length}, 1fr)`, gap: 5, background: T.bg, position: 'fixed', zIndex: 180, bottom: 0, left: '50%', transform: 'translateX(-50%)', boxShadow: '0 -10px 28px rgba(0,0,0,.16)' }}>
      {tabs.map(([key, label, icon, unread]) => (
        <button data-demo-tab={key} aria-pressed={current === key} key={key} onClick={() => onChange(key)} style={{ position: 'relative', background: current === key ? '#fff' : 'transparent', color: current === key ? '#05060d' : T.mu, border: 'none', borderRadius: 12, minHeight: 48, padding: '6px 3px', cursor: 'pointer', fontSize: tabs.length > 3 ? 10 : 11, fontWeight: 900, display: 'grid', placeItems: 'center', gap: 1 }}>
          {!!unread && unread > 0 && <span aria-label={`${unread} nouvelle${unread > 1 ? 's' : ''} notification${unread > 1 ? 's' : ''}`} style={{ position: 'absolute', top: 3, right: '18%', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 10, display: 'grid', placeItems: 'center', background: '#ef4444', color: '#fff', fontSize: 9, lineHeight: 1, boxShadow: `0 0 0 2px ${T.bg}` }}>+{unread}</span>}
          {icon && <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>{icon}</span>}
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function demoTodayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function demoAddDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function demoSlotMinutes(day: DemoMissionDay): number {
  if (!day.start || !day.end || day.start === day.end) return 0;
  const startParts = day.start.split(':').map(Number);
  const endParts = day.end.split(':').map(Number);
  const sh = startParts[0] ?? NaN;
  const sm = startParts[1] ?? NaN;
  const eh = endParts[0] ?? NaN;
  const em = endParts[1] ?? NaN;
  if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) return 0;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return end > start ? end - start : end + 1440 - start;
}

function demoHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1).replace('.', ',')} h`;
}

function demoDayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
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
  const [f, setF] = useState({ title: 'Renfort service du midi', place: 'Lille centre', hourly: isAsso ? 0 : 14, places: 2, solid: isAsso });
  const [days, setDays] = useState<DemoMissionDay[]>([{ date: demoTodayPlus(1), start: '12:00', end: '16:00' }]);
  const [showDetail, setShowDetail] = useState(false);
  const minutes = days.reduce((sum, day) => sum + demoSlotMinutes(day), 0);
  const workerAmount = f.solid ? 0 : Math.round(f.hourly * (minutes / 60));
  const workerSubtotal = workerAmount * f.places;
  const serviceFee = f.solid ? 0 : Math.round(workerSubtotal * DEMO_SERVICE_FEE_RATE);
  const total = workerSubtotal + serviceFee;
  const maxDaysReached = days.length >= 3;
  const firstDay = days[0] ?? { date: demoTodayPlus(1), start: '12:00', end: '16:00' };
  const ok = f.title.trim().length >= 2 && f.place.trim().length >= 2 && days.every((day) => day.date && day.start && day.end && demoSlotMinutes(day) > 0) && (f.solid || workerAmount > 0);

  function setDay(i: number, patch: Partial<DemoMissionDay>) {
    setDays((prev) => prev.map((day, idx) => (idx === i ? { ...day, ...patch } : day)));
  }

  function addDay() {
    if (maxDaysReached) return;
    setDays((prev) => {
      const last = prev[prev.length - 1] ?? firstDay;
      return [...prev, { date: demoAddDays(last.date, 1), start: last.start, end: last.end }];
    });
  }

  const whenLabel =
    days.length === 1
      ? `${demoDayLabel(firstDay.date)} · ${firstDay.start}-${firstDay.end}${firstDay.end < firstDay.start ? ' +1' : ''}`
      : `${days.length} jours · ${demoHours(minutes)} par personne`;

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
          {days.map((day, i) => (
            <div key={`${day.date}-${i}`} style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ color: T.text, fontSize: 12 }}>Jour {i + 1}</strong>
                {days.length > 1 && (
                  <button onClick={() => setDays((prev) => prev.filter((_, idx) => idx !== i))} style={{ background: 'rgba(239,68,68,.14)', color: '#f87171', border: 'none', borderRadius: 8, width: 26, height: 26, cursor: 'pointer' }}>×</button>
                )}
              </div>
              <input type="date" value={day.date} onChange={(e) => setDay(i, { date: e.target.value })} style={{ ...inp, marginBottom: 8, padding: '10px 9px', fontSize: 12 }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 8 }}>
                {DEMO_SHORTCUTS.map((shortcut) => (
                  <button key={shortcut.label} onClick={() => setDay(i, { start: shortcut.start, end: shortcut.end })} style={{ background: T.card, color: T.sub, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '7px 0', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}>
                    {shortcut.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input type="time" value={day.start} onChange={(e) => setDay(i, { start: e.target.value })} style={{ ...inp, marginBottom: 0, padding: '10px 9px', fontSize: 12 }} />
                <input type="time" value={day.end} onChange={(e) => setDay(i, { end: e.target.value })} style={{ ...inp, marginBottom: 0, padding: '10px 9px', fontSize: 12 }} />
              </div>
              <div style={{ color: T.mu, fontSize: 10, marginTop: 7 }}>{day.end < day.start ? `Fin le lendemain · ${demoHours(demoSlotMinutes(day))}` : demoHours(demoSlotMinutes(day))}</div>
            </div>
          ))}
          <button disabled={maxDaysReached} onClick={addDay} style={{ background: 'none', border: `1px dashed ${T.cb}`, color: T.sub, borderRadius: 9, padding: '9px 0', width: '100%', fontSize: 11, fontWeight: 800, cursor: maxDaysReached ? 'not-allowed' : 'pointer', opacity: maxDaysReached ? 0.5 : 1 }}>
            + Ajouter un jour
          </button>
          {maxDaysReached && <div style={{ color: T.amber, fontSize: 10.5, marginTop: 7 }}>Une mission dure 3 jours maximum.</div>}
        </Fld>
        <div style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 13, marginBottom: 14 }}>
          <div style={{ color: T.mu, fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>
            {whenLabel}
          </div>
          <div style={{ color: T.text, fontSize: 13, fontWeight: 900, marginBottom: 6 }}>
            {f.places} personne{f.places > 1 ? 's' : ''} · {days.length} jour{days.length > 1 ? 's' : ''} · {demoHours(minutes)} par personne
          </div>
          <div style={{ color: T.sub, fontSize: 11, marginBottom: 9 }}>{demoHours((minutes * f.places))} de travail au total</div>
          <div style={{ color: T.text, fontSize: 15, fontWeight: 900 }}>Coût total estimé : {total} €</div>
          {!f.solid && (
            <button onClick={() => setShowDetail((v) => !v)} style={{ marginTop: 8, background: 'none', border: 'none', color: T.mu, textDecoration: 'underline', fontSize: 10.5, padding: 0, cursor: 'pointer' }}>
              {showDetail ? 'Masquer le détail' : 'Voir le détail'}
            </button>
          )}
          {showDetail && !f.solid && (
            <div style={{ borderTop: `1px solid ${T.cb}`, marginTop: 9, paddingTop: 9, display: 'grid', gap: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: T.sub, fontSize: 12 }}><span>Rémunération totale des travailleurs</span><strong style={{ color: T.text }}>{workerSubtotal} €</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: T.sub, fontSize: 12 }}><span>Frais de service UROSI</span><strong style={{ color: T.text }}>{serviceFee} €</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: T.text, fontSize: 13, fontWeight: 900 }}><span>Total à payer</span><span>{total} €</span></div>
            </div>
          )}
          {f.solid && <div style={{ color: T.green, fontSize: 11, fontWeight: 800, marginTop: 8 }}>Mission solidaire : aucun coût, comptabilisée dans le CV vivant.</div>}
        </div>
        <Button
          disabled={!ok}
          onClick={() =>
            onPublish({
              id: `new-${Date.now()}`,
              structureId: isAsso ? DEMO_STRUCTURE_IDS.asso : DEMO_STRUCTURE_IDS.pme,
              title: f.title.trim(),
              structure: isAsso ? 'Banque Alimentaire' : 'Burger Nord',
              amount: workerAmount,
              city: f.place.trim(),
              when: whenLabel,
              duration: demoHours(minutes),
              rating: isAsso || f.solid ? 4.8 : 4.7,
              distance: 'démo',
              solid: f.solid,
              desc: f.solid ? 'Mission bénévole à 0 €. Elle enrichit le CV vivant.' : 'Mission publiée avec prix libre choisi par la structure.',
            })
          }
        >
          {f.solid ? 'Publier · Solidaire (0 €)' : `Publier · ${total} € au total`}
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

type MissionManageMode = 'menu' | 'edit' | 'schedule' | 'price' | 'archive' | 'delete' | 'cancel';

function DemoStructureMissionCard({ mission, index, candidateCount, completed, onOpen, onRepublish }: { mission: DemoMission; index: number; candidateCount: number; completed: boolean; onOpen: (mode?: MissionManageMode) => void; onRepublish: () => void }) {
  const [swiped, setSwiped] = useState(false);
  const startX = useRef(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  const held = useRef(false);

  function clearHold() {
    clearTimeout(holdTimer.current);
  }

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 12 }}>
      {swiped && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', background: T.row }}>
          <button onClick={() => completed ? onRepublish() : onOpen('edit')} style={{ border: 'none', background: '#1d4ed8', color: '#fff', fontSize: 11, fontWeight: 900 }}>{completed ? 'Republier' : 'Modifier'}</button>
          <button onClick={() => onOpen(candidateCount === 0 && mission.status === 'draft' ? 'delete' : 'archive')} style={{ border: 'none', background: candidateCount === 0 && mission.status === 'draft' ? '#991b1b' : '#475569', color: '#fff', fontSize: 11, fontWeight: 900 }}>{candidateCount === 0 && mission.status === 'draft' ? 'Supprimer' : 'Archiver'}</button>
        </div>
      )}
      <div
        style={{ position: 'relative', transform: swiped ? 'translateX(-42%)' : 'translateX(0)', transition: 'transform 180ms ease', background: T.bg }}
        onPointerDown={(event) => {
          startX.current = event.clientX;
          held.current = false;
          holdTimer.current = setTimeout(() => {
            held.current = true;
            onOpen();
          }, 900);
        }}
        onPointerUp={(event) => {
          clearHold();
          if (!held.current && event.clientX - startX.current < -55) setSwiped(true);
        }}
        onPointerCancel={clearHold}
        onPointerLeave={clearHold}
      >
        {index === 0 && <div style={{ fontSize: 9, fontWeight: 800, color: T.cyan, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 4 }}>★ Dernière mission publiée</div>}
        <div style={{ background: T.card, border: `1px solid ${index === 0 ? '#0e7490' : T.cb}`, borderRadius: 12, padding: '13px 15px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <button type="button" onClick={() => { if (!held.current) onOpen(); }} style={{ flex: 1, minWidth: 0, padding: 0, border: 'none', background: 'none', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              <div style={{ color: T.text, fontSize: 14, fontWeight: 900 }}>{mission.title}</div>
              <div style={{ color: T.mu, fontSize: 10, marginTop: 4 }}>{mission.structure} · {mission.city} · {mission.when} · {mission.duration}</div>
              <div style={{ color: T.sub, fontSize: 10.5, marginTop: 5, lineHeight: 1.45 }}>{mission.desc}</div>
            </button>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <button aria-label={`Actions pour ${mission.title}`} onClick={() => onOpen()} style={{ border: 'none', background: 'none', color: T.mu, fontSize: 20, fontWeight: 900, cursor: 'pointer', padding: '0 0 4px 12px' }}>•••</button>
              <div style={{ color: mission.solid ? T.green : T.text, fontSize: 18, fontWeight: 900 }}>{mission.solid ? 'Solidaire' : `${mission.amount} €`}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <span style={{ color: mission.status === 'draft' ? T.amber : completed ? T.cyan : T.green, background: mission.status === 'draft' ? T.amberBg : completed ? '#22d3ee15' : T.greenBg, borderRadius: 10, padding: '2px 8px', fontSize: 9, fontWeight: 900 }}>{mission.status === 'draft' ? 'Brouillon' : completed ? 'Terminée' : candidateCount > 0 ? 'Candidatures reçues' : 'Active'}</span>
            <span style={{ color: candidateCount > 0 ? T.cyan : T.mu, fontSize: 10 }}>{candidateCount > 0 ? `${candidateCount} candidat${candidateCount > 1 ? 's' : ''}` : 'Aucun candidat'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MissionManageSheet({
  mission,
  candidateCount,
  hasAcceptedCandidate,
  completed,
  initialMode = 'menu',
  onClose,
  onArchive,
  onDelete,
  onCancel,
  onDuplicate,
  onContact,
  onUpdateDetails,
  onUpdateAmount,
}: {
  mission: DemoMission;
  candidateCount: number;
  hasAcceptedCandidate: boolean;
  completed: boolean;
  initialMode?: MissionManageMode;
  onClose: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onCancel: (reason: string) => void;
  onDuplicate: () => void;
  onContact: () => void;
  onUpdateDetails: (patch: Partial<Pick<DemoMission, 'title' | 'desc' | 'city' | 'when' | 'duration'>>) => void;
  onUpdateAmount: (amount: number) => void;
}) {
  const [mode, setMode] = useState<MissionManageMode>(initialMode);
  const [amount, setAmount] = useState(mission.amount);
  const [details, setDetails] = useState({ title: mission.title, desc: mission.desc, city: mission.city, when: mission.when, duration: mission.duration });
  const [reason, setReason] = useState('Besoin annulé');
  const [showCost, setShowCost] = useState(false);
  const places = mission.places ?? 1;

  const actionButton = (label: string, action: () => void, tone: 'light' | 'ghost' | 'red' | 'green' = 'light') => <Button tone={tone} onClick={action}>{label}</Button>;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Gérer la mission ${mission.title}`} onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 210 }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: '100%', maxWidth: 430, background: T.card, borderRadius: '24px 24px 0 0', padding: '20px 18px 28px' }}>
        <div style={{ width: 42, height: 4, borderRadius: 3, background: T.cb, margin: '0 auto 16px' }} />
        <div style={{ color: T.text, fontSize: 17, fontWeight: 900 }}>{mission.title}</div>
        <div style={{ color: T.mu, fontSize: 10, margin: '4px 0 16px' }}>{mission.when} · {mission.city}</div>

        {mode === 'menu' && (
          <div style={{ display: 'grid', gap: 8 }}>
            {completed ? (
              <>
                {actionButton('Voir les détails', () => setMode('edit'))}
                {actionButton('Télécharger le récapitulatif', () => downloadDemoMissionRecap(mission))}
                {actionButton('Republier cette mission', onDuplicate, 'green')}
                {actionButton('Archiver', () => setMode('archive'), 'ghost')}
              </>
            ) : hasAcceptedCandidate ? (
              <>
                {actionButton('Voir / modifier les informations non sensibles', () => setMode('edit'))}
                {actionButton('Contacter le candidat', onContact, 'green')}
                {actionButton('Dupliquer la mission', onDuplicate)}
                {actionButton('Annuler la mission', () => setMode('cancel'), 'red')}
              </>
            ) : (
              <>
                {actionButton('Modifier la mission', () => setMode('edit'))}
                {!mission.solid && actionButton('Modifier le prix', () => setMode('price'))}
                {actionButton('Modifier la date et les horaires', () => setMode('schedule'))}
                {actionButton('Dupliquer la mission', onDuplicate, 'green')}
                {actionButton('Archiver', () => setMode('archive'), 'ghost')}
                {candidateCount > 0 ? actionButton('Annuler la mission', () => setMode('cancel'), 'red') : actionButton('Supprimer', () => setMode('delete'), 'red')}
              </>
            )}
            {actionButton('Fermer', onClose, 'ghost')}
          </div>
        )}

        {mode === 'price' && !mission.solid && (
          <div style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 13, padding: 12, marginBottom: 10 }}>
            <label htmlFor="demo-mission-amount" style={{ display: 'block', color: T.sub, fontSize: 10, fontWeight: 900, marginBottom: 7 }}>Prix par personne</label>
            <input id="demo-mission-amount" type="number" min={1} value={amount || ''} onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))} style={inp} />
            <div style={{ color: T.sub, fontSize: 10, lineHeight: 1.6 }}>Nombre d’heures : {mission.duration}<br />Personnes recherchées : {places}<br /><strong style={{ color: T.text }}>Coût estimé : {amount * places} €</strong></div>
            <button onClick={() => setShowCost((value) => !value)} style={{ background: 'none', border: 'none', color: T.cyan, padding: '8px 0', fontSize: 10, cursor: 'pointer' }}>Voir le détail du coût</button>
            {showCost && <div style={{ color: T.mu, fontSize: 9.5, marginBottom: 8 }}>Rémunération : {amount * places} € · estimation avant éventuels frais affichés au récapitulatif.</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><Button tone="ghost" onClick={() => setMode('menu')}>Retour</Button><Button disabled={amount < 1} onClick={() => onUpdateAmount(amount)}>Enregistrer</Button></div>
          </div>
        )}
        {mode === 'edit' && <div style={{ display: 'grid', gap: 8 }}><input disabled={completed} value={details.title} onChange={(e) => setDetails((v) => ({ ...v, title: e.target.value }))} aria-label="Titre de la mission" style={inp} /><textarea disabled={completed} value={details.desc} onChange={(e) => setDetails((v) => ({ ...v, desc: e.target.value }))} aria-label="Description de la mission" style={{ ...inp, minHeight: 82 }} /><input disabled={completed} value={details.city} onChange={(e) => setDetails((v) => ({ ...v, city: e.target.value }))} aria-label="Adresse de la mission" style={inp} />{hasAcceptedCandidate && <div style={{ color: T.amber, background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 10, padding: 10, fontSize: 10 }}>Seules les informations non sensibles sont modifiables. Le prix et les horaires restent bloqués.</div>}{completed ? <Button tone="ghost" onClick={() => setMode('menu')}>Retour</Button> : <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><Button tone="ghost" onClick={() => setMode('menu')}>Retour</Button><Button onClick={() => onUpdateDetails({ title: details.title, desc: details.desc, city: details.city })}>Enregistrer</Button></div>}</div>}
        {mode === 'schedule' && <div style={{ display: 'grid', gap: 8 }}><label style={{ color: T.sub, fontSize: 10 }}>Date et horaires<input value={details.when} onChange={(e) => setDetails((v) => ({ ...v, when: e.target.value }))} style={{ ...inp, marginTop: 5 }} /></label><label style={{ color: T.sub, fontSize: 10 }}>Durée<input value={details.duration} onChange={(e) => setDetails((v) => ({ ...v, duration: e.target.value }))} style={{ ...inp, marginTop: 5 }} /></label><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><Button tone="ghost" onClick={() => setMode('menu')}>Retour</Button><Button onClick={() => onUpdateDetails({ when: details.when, duration: details.duration })}>Enregistrer</Button></div></div>}
        {mode === 'archive' && <div style={{ background: T.row, borderRadius: 13, padding: 13 }}><div style={{ color: T.text, fontSize: 14, fontWeight: 900 }}>Archiver cette mission ?</div><div style={{ color: T.sub, fontSize: 10.5, lineHeight: 1.5, margin: '6px 0 12px' }}>Elle ne sera plus affichée dans les missions actives, mais restera disponible dans ton historique.</div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><Button tone="ghost" onClick={() => setMode('menu')}>Annuler</Button><Button onClick={onArchive}>Archiver</Button></div></div>}
        {mode === 'delete' && <div style={{ background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 13, padding: 13 }}><div style={{ color: T.red, fontSize: 14, fontWeight: 900 }}>Supprimer cette mission ?</div><div style={{ color: T.sub, fontSize: 10.5, lineHeight: 1.5, margin: '6px 0 12px' }}>Cette action est définitive. La mission ne sera plus visible dans ton espace.</div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><Button tone="ghost" onClick={() => setMode('menu')}>Annuler</Button><Button tone="red" onClick={onDelete}>Supprimer définitivement</Button></div></div>}
        {mode === 'cancel' && <div style={{ background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 13, padding: 13 }}><div style={{ color: T.red, fontSize: 14, fontWeight: 900 }}>Annuler cette mission ?</div><div style={{ color: T.sub, fontSize: 10.5, lineHeight: 1.5, margin: '6px 0 10px' }}>Les candidats concernés seront informés et la mission restera visible dans l’historique.</div><select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motif de l’annulation" style={inp}><option>Besoin annulé</option><option>Changement d’horaires</option><option>Erreur de publication</option><option>Autre</option></select><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><Button tone="ghost" onClick={() => setMode('menu')}>Retour</Button><Button tone="red" onClick={() => onCancel(reason)}>Confirmer l’annulation</Button></div></div>}
      </div>
    </div>
  );
}

function StructureDemo({ founder, onBack, accountName }: { founder: boolean; onBack: () => void; accountName?: string }) {
  const [kind, setKind] = useState<StructureKind | null>('pme');
  const [tab, setTab] = useState<StructureTab>('missions');
  const [missions, setMissions] = useState<DemoMission[]>(() => structureMissions('pme'));
  const [candidates, setCandidates] = useState<DemoCandidate[]>(() => structureCandidates('pme'));
  const [demoState, setDemoState] = useState<DemoSharedState>(() => readDemoState());
  const [panel, setPanel] = useState<DemoCandidate | null>(null);
  const [showPub, setShowPub] = useState(false);
  const [managedMission, setManagedMission] = useState<{ mission: DemoMission; mode?: MissionManageMode } | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [showStatsIntro, setShowStatsIntro] = useState(true);
  const [showStructureReviews, setShowStructureReviews] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const tr = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function refresh(event: StorageEvent) {
      if (event.key !== DEMO_SHARED_KEY) return;
      const next = readDemoState();
      setDemoState(next);
      if (kind) {
        setMissions(structureMissions(kind));
        setCandidates(structureCandidates(kind));
      }
    }
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [kind]);

  useEffect(() => {
    if (!kind) return;
    setShowStatsIntro(true);
    const timer = window.setTimeout(() => setShowStatsIntro(false), 3000);
    return () => window.clearTimeout(timer);
  }, [kind]);

  function notif(m: string) {
    setToast(m);
    clearTimeout(tr.current);
    tr.current = setTimeout(() => setToast(null), 2600);
  }

  function choose(next: StructureKind) {
    setKind(next);
    setShowStatsIntro(true);
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
  const displayedStructureName = accountName ?? seed.name;
  const pending = candidates.filter((c) => c.status === 'pending');
  const regulars = candidates.filter((c) => c.here >= 2);
  const visibleCandidateIds = new Set(candidates.map((candidate) => candidate.id));
  const candidateUnread = demoState.structureUnreadCandidateIds.filter((id) => visibleCandidateIds.has(id)).length;
  const visibleMissionIds = new Set(missions.map((mission) => mission.id));
  const delayNotices = demoState.delayNotices.filter((notice) => visibleMissionIds.has(notice.missionId));
  const archivedMissions = archivedStructureMissions(kind);
  const cancelledMissions = cancelledStructureMissions(kind);

  function decide(id: string, status: CandidateStatus) {
    const candidate = candidates.find((item) => item.id === id);
    if (candidate) rememberCandidateDecision(candidate, status);
    setCandidates((list) => list.map((c) => (c.id === id ? { ...c, status } : c)));
    setPanel((c) => (c && c.id === id ? { ...c, status } : c));
    setDemoState(readDemoState());
    notif(status === 'accepted' ? 'Candidat accepté. Il voit la mission confirmée.' : 'Candidat refusé sans pénalité.');
  }

  function changeStructureTab(next: StructureTab) {
    setTab(next);
    if (next !== 'candidats' || candidateUnread === 0) return;
    const state = readDemoState();
    writeDemoState({ ...state, structureUnreadCandidateIds: state.structureUnreadCandidateIds.filter((id) => !visibleCandidateIds.has(id)) });
    setDemoState(readDemoState());
  }

  function dismissDelay(missionId: string) {
    const state = readDemoState();
    writeDemoState({ ...state, delayNotices: state.delayNotices.filter((notice) => notice.missionId !== missionId) });
    setDemoState(readDemoState());
  }

  function manageMission(action: 'archive' | 'delete', mission: DemoMission) {
    const changed = hideDemoMission(mission, action);
    if (!changed) {
      notif('Suppression impossible : cette mission possède déjà une candidature. Utilise Annuler ou Archiver.');
      return;
    }
    refreshFromDemoState();
    setManagedMission(null);
    notif(action === 'archive' ? 'Mission archivée des deux côtés.' : 'Mission supprimée des deux côtés. Les doublons identiques ont aussi été retirés.');
  }

  function updateMissionAmount(mission: DemoMission, amount: number) {
    updateDemoMissionAmount(mission.id, amount);
    refreshFromDemoState();
    setManagedMission(null);
    notif(`Prix de la mission modifié : ${Math.round(amount)} €.`);
  }

  function updateMissionDetails(mission: DemoMission, patch: Partial<Pick<DemoMission, 'title' | 'desc' | 'city' | 'when' | 'duration'>>) {
    updateDemoMissionDetails(mission.id, patch);
    refreshFromDemoState();
    setManagedMission(null);
    notif('Mission modifiée.');
  }

  function duplicateMission(mission: DemoMission, completed: boolean) {
    duplicateDemoMission(mission);
    refreshFromDemoState();
    setManagedMission(null);
    notif(completed ? 'Mission republiée en brouillon : vérifie la date et les horaires.' : 'Mission dupliquée en brouillon : vérifie la date et les horaires.');
  }

  function cancelMissionFromStructure(mission: DemoMission, reason: string) {
    cancelDemoMission(mission.id, reason);
    refreshFromDemoState();
    setManagedMission(null);
    notif('Mission annulée. Les candidats sont informés.');
  }

  function restoreMission(mission: DemoMission) {
    restoreDemoMission(mission);
    refreshFromDemoState();
    notif('Mission restaurée dans le flux et dans l’espace structure.');
  }

  function refreshFromDemoState() {
    if (!kind) return;
    setMissions(structureMissions(kind));
    setCandidates(structureCandidates(kind));
    setDemoState(readDemoState());
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

  return (
    <>
      <TopBar title="Espace structure" badge={displayedStructureName} onBack={onBack} founder={founder} />
      {toast && <div style={{ margin: '10px 14px 0', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 10, padding: '8px 12px', color: T.sub, fontSize: 11 }}>{toast}</div>}
      <div style={{ padding: 16, paddingBottom: 92, minHeight: 620 }}>
        <div style={{ background: T.card, border: `1px solid ${T.greenBorder}`, borderRadius: 16, padding: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 14, background: kind === 'asso' ? '#14532d' : '#075985', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900 }}>{initials(displayedStructureName)}</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: T.text, fontSize: 16, lineHeight: 1.2, fontWeight: 900, overflowWrap: 'anywhere' }}>{displayedStructureName}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              <span style={{ color: T.green, background: T.greenBg, borderRadius: 11, padding: '2px 7px', fontSize: 9, fontWeight: 900 }}>{seed.verified}</span>
              <span style={{ color: kind === 'asso' ? T.green : T.cyan, background: kind === 'asso' ? T.greenBg : '#22d3ee15', borderRadius: 11, padding: '2px 7px', fontSize: 9, fontWeight: 900 }}>{seed.type}</span>
            </div>
            <button
              type="button"
              aria-label="Voir les avis reçus"
              onClick={() => setShowStructureReviews(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 7, padding: 0, border: 0, background: 'transparent', color: T.text, cursor: 'pointer', fontSize: 10, fontWeight: 900 }}
            >
              <Stars n={kind === 'pme' ? 4.8 : 5} size={10} />
              <span>{kind === 'pme' ? '4,8' : '5,0'}</span>
              <span style={{ color: T.mu, fontWeight: 700 }}>· {kind === 'pme' ? 21 : 15} avis ›</span>
            </button>
          </div>
          <button onClick={() => setKind(null)} style={{ background: T.row, color: T.mu, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '7px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>Changer</button>
        </div>
        <div style={{ color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 12, padding: '10px 12px', fontSize: 10.5, fontWeight: 900, marginBottom: 12 }}>
          ✓ Structure vérifiée · identité et SIRET confirmés (démo)
        </div>
        {showStatsIntro && tab !== 'historique' && <StructureStats stats={seed.stats} live />}
        <BottomTabs
          tabs={[
            ['missions', `Missions ${missions.length}`],
            ['candidats', `Candidats ${pending.length}`, undefined, candidateUnread],
            ['habitues', `Habitués ${regulars.length}`],
            ['historique', 'Historique'],
          ]}
          current={tab}
          onChange={(v) => changeStructureTab(v as StructureTab)}
        />
        <div style={{ height: 12 }} />
        {tab === 'missions' && (
          <div style={{ display: 'grid', gap: 10 }}>
            {delayNotices.map((notice) => (
              <div key={notice.missionId} role="status" style={{ background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 14, padding: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: T.amber, fontSize: 11, fontWeight: 900 }}>+1 · Retard signalé : {notice.minutes}{notice.minutes === 30 ? '+' : ''} min</div>
                  <div style={{ color: T.sub, fontSize: 10, marginTop: 3 }}>{notice.missionTitle} · Alex Démo</div>
                </div>
                <button onClick={() => dismissDelay(notice.missionId)} style={{ background: T.row, color: T.text, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '7px 9px', fontSize: 9, fontWeight: 900, cursor: 'pointer' }}>Vu</button>
              </div>
            ))}
            <div style={{ position: 'relative' }}>
              <Button onClick={() => setShowPub(true)}>Publier une mission</Button>
              <button
                type="button"
                aria-label="Deux missions disponibles en mode démo"
                onClick={() => notif('Vous pouvez créer deux missions en mode démo.')}
                style={{
                  position: 'absolute',
                  top: -8,
                  right: -7,
                  minWidth: 27,
                  height: 27,
                  padding: '0 6px',
                  borderRadius: 14,
                  border: '2px solid #080a13',
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 900,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px #0008',
                }}
              >
                +2
              </button>
            </div>
            <div style={{ color: T.mu, fontSize: 9.5, textAlign: 'center' }}>Touche une mission ou utilise •••. Appui long ou swipe gauche disponibles sur mobile.</div>
            {missions.map((m, i) => {
              const allMissionCandidates = candidates.filter((candidate) => candidate.missionId === m.id);
              const completed = demoState.completedMissionIds.includes(m.id);
              return <DemoStructureMissionCard key={m.id} mission={m} index={i} candidateCount={allMissionCandidates.length} completed={completed} onOpen={(mode) => setManagedMission({ mission: m, mode })} onRepublish={() => duplicateMission(m, completed)} />;
            })}
          </div>
        )}
        {tab === 'historique' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <div style={{ color: T.text, fontSize: 13, fontWeight: 900, marginBottom: 8 }}>Performance de la structure</div>
              <StructureStats stats={seed.stats} />
            </div>
            {archivedMissions.length > 0 && (
              <div style={{ background: T.card, border: `1px solid ${T.amberBorder}`, borderRadius: 16, padding: 15 }}>
                <div style={{ color: T.text, fontSize: 13, fontWeight: 900 }}>Missions archivées · {archivedMissions.length}</div>
                <div style={{ color: T.mu, fontSize: 9, margin: '3px 0 8px' }}>Masquées du flux travailleur et de la liste active.</div>
                {archivedMissions.map((mission) => (
                  <div key={mission.id} style={{ borderTop: `1px solid ${T.cb}`, padding: '9px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: T.text, fontSize: 11, fontWeight: 800 }}>{mission.title}</div>
                      <div style={{ color: T.mu, fontSize: 9, marginTop: 2 }}>{mission.when} · {mission.solid ? 'Solidaire' : `${mission.amount} €`}</div>
                    </div>
                    <button onClick={() => restoreMission(mission)} style={{ background: T.row, color: T.cyan, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '7px 9px', fontSize: 9, fontWeight: 900, cursor: 'pointer' }}>Restaurer</button>
                  </div>
                ))}
              </div>
            )}
            {cancelledMissions.length > 0 && (
              <div style={{ background: T.card, border: `1px solid ${T.redBorder}`, borderRadius: 16, padding: 15 }}>
                <div style={{ color: T.text, fontSize: 13, fontWeight: 900 }}>Missions annulées · {cancelledMissions.length}</div>
                <div style={{ color: T.mu, fontSize: 9, margin: '3px 0 8px' }}>Conservées avec leurs candidatures et leur motif.</div>
                {cancelledMissions.map((mission) => (
                  <div key={mission.id} style={{ borderTop: `1px solid ${T.cb}`, padding: '9px 0' }}>
                    <div style={{ color: T.text, fontSize: 11, fontWeight: 800 }}>{mission.title}</div>
                    <div style={{ color: T.red, fontSize: 9, marginTop: 2 }}>{demoState.cancellationReasons[mission.id] ?? 'Besoin annulé'}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 15 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ color: T.text, fontSize: 13, fontWeight: 900 }}>Missions terminées</div>
                  <div style={{ color: T.mu, fontSize: 9 }}>5 affichées par défaut</div>
                </div>
                <button onClick={() => downloadDemoHistory(kind)} style={{ background: T.row, color: T.cyan, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '7px 9px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}>Télécharger</button>
              </div>
              {(historyExpanded ? demoStructureHistory[kind] : demoStructureHistory[kind].slice(0, 5)).map((row) => (
                <div key={`${row.date}-${row.title}`} style={{ borderTop: `1px solid ${T.cb}`, padding: '9px 0', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ color: T.text, fontSize: 11, fontWeight: 800 }}>{row.title}</div>
                    <div style={{ color: T.mu, fontSize: 9, marginTop: 3 }}>{new Date(`${row.date}T12:00:00`).toLocaleDateString('fr-FR')} · 📍 {row.address}</div>
                  </div>
                  <div style={{ color: row.amount === 0 ? T.green : T.text, fontWeight: 900, fontSize: 11, whiteSpace: 'nowrap' }}>{row.amount === 0 ? 'Solidaire' : `${row.amount} €`}</div>
                </div>
              ))}
              {demoStructureHistory[kind].length > 5 && <Button tone="ghost" onClick={() => setHistoryExpanded((value) => !value)}>{historyExpanded ? 'Réduire' : 'Voir tout l’historique'}</Button>}
            </div>
            <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 15 }}>
              <div style={{ color: T.text, fontSize: 13, fontWeight: 900 }}>Avis anonymes</div>
              <div style={{ color: T.mu, fontSize: 9, margin: '3px 0 9px' }}>Publication le lundi par lots de 3 avis · sinon report · aucun auteur affiché</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Stars n={kind === 'pme' ? 4.8 : 5} size={13} /><strong>{kind === 'pme' ? '4,8' : '5,0'}</strong><span style={{ color: T.mu, fontSize: 10 }}>({kind === 'pme' ? 21 : 15} avis)</span></div>
              <div style={{ color: T.sub, fontSize: 10.5, borderTop: `1px solid ${T.cb}`, marginTop: 9, paddingTop: 9 }}>★★★★★ · « Équipe accueillante et consignes claires. »</div>
            </div>
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
      {showStructureReviews && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 195 }} onClick={() => setShowStructureReviews(false)}>
          <section aria-label="Avis reçus par la structure" style={{ width: '100%', maxWidth: 430, maxHeight: '82vh', overflowY: 'auto', background: T.bg, borderRadius: '24px 24px 0 0', padding: '18px 18px 26px' }} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ color: T.text, fontSize: 16, fontWeight: 900 }}>Avis reçus</div>
                <div style={{ color: T.mu, fontSize: 9.5, marginTop: 3 }}>Anonymes · publiés par lots pour protéger les travailleurs</div>
              </div>
              <button aria-label="Fermer les avis" onClick={() => setShowStructureReviews(false)} style={{ width: 38, height: 38, borderRadius: 19, border: `1px solid ${T.cb}`, background: T.card, color: T.text, fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            <StructureReviewList initialCount={kind === 'pme' ? 2 : 3} total={kind === 'pme' ? 21 : 15} />
          </section>
        </div>
      )}
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
                ['Missions', String(panel.history.length)],
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
      {managedMission && (
        <MissionManageSheet
          mission={managedMission.mission}
          initialMode={managedMission.mode}
          candidateCount={candidates.filter((candidate) => candidate.missionId === managedMission.mission.id).length}
          hasAcceptedCandidate={candidates.some((candidate) => candidate.missionId === managedMission.mission.id && candidate.status === 'accepted')}
          completed={demoState.completedMissionIds.includes(managedMission.mission.id)}
          onClose={() => setManagedMission(null)}
          onArchive={() => manageMission('archive', managedMission.mission)}
          onDelete={() => manageMission('delete', managedMission.mission)}
          onCancel={(reason) => cancelMissionFromStructure(managedMission.mission, reason)}
          onDuplicate={() => duplicateMission(managedMission.mission, demoState.completedMissionIds.includes(managedMission.mission.id))}
          onContact={() => {
            setTab('candidats');
            setManagedMission(null);
          }}
          onUpdateDetails={(patch) => updateMissionDetails(managedMission.mission, patch)}
          onUpdateAmount={(amount) => updateMissionAmount(managedMission.mission, amount)}
        />
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}><Stars n={candidate.note} size={11} /><span style={{ color: T.mu, fontSize: 10 }}>{candidate.note} · {candidate.history.length} missions</span></div>
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

function DemoFounderScanPage({ missionId, title, structure, step }: { missionId: string; title: string; structure: string; step: DemoQrStep }) {
  const isStart = step === 'start';
  const activationKey = `urosi_demo_mission_${step}_v1:${missionId}`;
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(() => hasDemoFounderAccess());
  const [activated, setActivated] = useState(() => {
    try {
      return localStorage.getItem(activationKey) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (activated) rememberMissionScan(missionId, step);
  }, [activated, missionId, step]);

  function confirmMission() {
    if (!authorized && !isDemoFounderCode(code)) {
      setError('Code fondateur invalide.');
      return;
    }
    if (!authorized) {
      rememberDemoFounderAccess();
      setAuthorized(true);
    }
    try {
      localStorage.setItem(activationKey, '1');
    } catch {
      // La confirmation reste visible pour la session courante.
    }
    rememberMissionScan(missionId, step);
    setActivated(true);
    setError(null);
  }

  return (
    <DemoShell>
      <div style={{ minHeight: 'calc(100vh - 44px)', padding: '24px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '100%', background: T.card, border: `1px solid ${activated ? T.greenBorder : T.cb}`, borderRadius: 20, padding: 22, textAlign: 'center' }}>
          <Logo sz={42} />
          <div style={{ color: T.amber, fontSize: 9, fontWeight: 900, letterSpacing: 1.1, marginTop: 14 }}>{isStart ? 'ACTIVATION' : 'CLÔTURE'} FONDATEUR · SIMULATION</div>
          <div style={{ color: T.text, fontSize: 19, fontWeight: 900, marginTop: 7 }}>{activated ? (isStart ? 'Mission activée' : 'Mission terminée') : (isStart ? 'Activer cette mission' : 'Terminer cette mission')}</div>
          <div style={{ color: T.sub, fontSize: 12, lineHeight: 1.55, margin: '7px 0 16px' }}>
            {title || 'Mission de démonstration'}<br />{structure || 'Structure fictive'}
          </div>
          {activated ? (
            <>
              <div style={{ color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 13, padding: 14, fontSize: 12, fontWeight: 900, marginBottom: 14 }}>✓ {isStart ? 'Activation' : 'Fin de mission'} simulée confirmée</div>
              <Link to="/demo?role=structure" style={{ display: 'block', background: '#f8fafc', color: '#080b12', borderRadius: 12, padding: '13px 16px', textDecoration: 'none', fontSize: 13, fontWeight: 900 }}>Ouvrir la démo structure</Link>
            </>
          ) : (
            <>
              {authorized ? (
                <div style={{ color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 11, padding: 10, marginBottom: 9, fontSize: 10.5, fontWeight: 900 }}>Accès fondateur déjà validé · aucun mot de passe à ressaisir</div>
              ) : (
                <input
                  aria-label="Code fondateur de démonstration"
                  value={code}
                  onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(null); }}
                  onKeyDown={(event) => event.key === 'Enter' && confirmMission()}
                  placeholder="Code fondateur"
                  autoCapitalize="characters"
                  autoComplete="off"
                  style={{ ...inp, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.3, marginBottom: 9 }}
                />
              )}
              {error && <div role="alert" style={{ color: T.red, fontSize: 11, marginBottom: 9 }}>{error}</div>}
              <Button onClick={confirmMission}>{isStart ? 'Activer' : 'Terminer'} la mission · simulation</Button>
            </>
          )}
          <div style={{ color: T.mu, fontSize: 10, lineHeight: 1.5, marginTop: 14 }}>
            Test local à ce téléphone : aucune mission Supabase n’est modifiée et l’ordinateur ne se met pas à jour.
          </div>
        </div>
      </div>
    </DemoShell>
  );
}

function DemoLimitOverlay({ role, embedded, onFounder }: { role: DemoRole; embedded: boolean; onFounder: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function unlock() {
    if (!isDemoFounderCode(code)) {
      setError('Code interne invalide.');
      return;
    }
    rememberDemoFounderAccess();
    onFounder();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,15,.86)', backdropFilter: 'blur(7px)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, fontFamily: FONT }}>
      <div style={{ width: '100%', maxWidth: 380, background: T.card, border: `1px solid ${T.cb}`, borderRadius: 20, padding: 24, textAlign: 'center' }}>
        <Logo sz={58} />
        <div style={{ color: T.text, fontSize: 19, fontWeight: 900, margin: '18px 0 7px' }}>Fin de l’aperçu gratuit</div>
        <div style={{ color: T.sub, fontSize: 12, lineHeight: 1.65, marginBottom: 18 }}>Crée ton compte ou connecte-toi pour continuer.</div>
        <Link to={role === 'structure' ? '/inscription/structure' : '/inscription/travailleur'} target={embedded ? '_top' : undefined} style={{ textDecoration: 'none', display: 'block', marginBottom: 8 }}><Button>Créer mon compte</Button></Link>
        <Link to="/connexion" target={embedded ? '_top' : undefined} style={{ textDecoration: 'none', display: 'block', marginBottom: 16 }}><Button tone="light">J’ai déjà un compte</Button></Link>
        {open && (
          <div style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 10, marginTop: 8 }}>
            <input
              aria-label="Code interne"
              value={code}
              onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(null); }}
              onKeyDown={(event) => event.key === 'Enter' && unlock()}
              placeholder="code"
              style={{ ...inp, marginBottom: 8, fontSize: 11, padding: '9px 10px', textTransform: 'uppercase', letterSpacing: 1 }}
              autoCapitalize="characters"
              autoComplete="off"
            />
            {error && <div style={{ color: T.red, fontSize: 11, marginBottom: 8 }}>{error}</div>}
            <Button onClick={unlock}>Ouvrir l’espace fondateur</Button>
          </div>
        )}
        <button aria-label="Accès interne" onClick={() => setOpen((value) => !value)} style={{ width: 6, height: 6, borderRadius: 999, background: open ? T.cyan : T.cb, border: 'none', opacity: open ? 0.9 : 0.3, cursor: 'pointer', padding: 0, marginTop: 14 }} />
      </div>
    </div>
  );
}

export function DemoExperience() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const embedded = params.get('embed') === '1';
  const initialRole = params.get('role') === 'structure' ? 'structure' : params.get('role') === 'worker' ? 'worker' : null;
  const guidedTour = embedded && params.get('tour') === '1';
  const founderScan = params.get('scan') === 'founder';
  const scannedStep: DemoQrStep = params.get('step') === 'end' ? 'end' : 'start';
  const scannedMissionId = params.get('mission') || 'mission-demo';
  const scannedMissionTitle = params.get('title') || 'Mission de démonstration';
  const scannedStructure = params.get('structure') || 'Structure fictive';
  const labAccount = findLocalLabAccount(params.get('labAccount'));
  const [role, setRole] = useState<DemoRole | null>(initialRole);
  const [used, setUsed] = useState(() => readNumber(DEMO_KEY));
  const [demoVersion, setDemoVersion] = useState(0);
  const [founderByCode, setFounderByCode] = useState(() => hasDemoFounderAccess() || hasRememberedFounderAccess(session?.user.id));
  const founder = isFounderEmail(session?.user.email) || founderByCode;
  const displayedFounder = embedded ? false : founder;
  const frozen = Boolean(role && !founder && !guidedTour && used >= DEMO_SECONDS);
  const left = Math.max(0, DEMO_SECONDS - used);

  useEffect(() => {
    let alive = true;
    if (embedded) {
      return undefined;
    }
    if (!session) {
      setFounderByCode(hasDemoFounderAccess());
      return undefined;
    }
    if (hasDemoFounderAccess() || isFounderEmail(session.user.email) || hasRememberedFounderAccess(session.user.id)) {
      setFounderByCode(true);
      return undefined;
    }
    hasFounderAccess()
      .then((value) => {
        if (alive) setFounderByCode(value);
      })
      .catch(() => {
        if (alive) setFounderByCode(hasDemoFounderAccess());
      });
    return () => {
      alive = false;
    };
  }, [embedded, session]);

  useEffect(() => {
    if (!role || founder || frozen || guidedTour) return undefined;
    const id = window.setInterval(() => {
      setUsed((previous) => {
        const next = previous + 1;
        try {
          localStorage.setItem(DEMO_KEY, String(next));
        } catch {
          // ignore
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [role, founder, frozen, guidedTour]);

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

  function returnToDemoChoice() {
    setRole(null);
    navigate(embedded ? '/demo?embed=1' : '/demo', { replace: true });
  }

  function openFounderArea() {
    const destination = session ? '/fondateur/kyc' : '/connexion?next=/fondateur/kyc&fondateur=1';
    if (embedded && window.top && window.top !== window) {
      window.top.location.assign(destination);
      return;
    }
    navigate(destination, { replace: true });
  }

  if (founderScan) {
    return <DemoFounderScanPage missionId={scannedMissionId} title={scannedMissionTitle} structure={scannedStructure} step={scannedStep} />;
  }

  if (!role) {
    return (
      <DemoShell embedded={embedded}>
        <div style={{ minHeight: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ position: 'absolute', top: 16, right: 16 }}><ThemeToggle /></div>
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
            ) : <div style={{ color: T.mu, fontSize: 11 }}>Aperçu gratuit : {left}s restantes</div>}
          </div>
        </div>
      </DemoShell>
    );
  }

  return (
    <>
      {!founder && !embedded && (
        <div style={{ position: 'fixed', top: 18, right: 18, zIndex: 450, background: left > 8 ? T.amberBg : T.redBg, color: left > 8 ? T.amber : T.red, border: `1px solid ${left > 8 ? T.amberBorder : T.redBorder}`, borderRadius: 18, padding: '7px 13px', fontFamily: FONT, fontSize: 12, fontWeight: 900 }}>
          Aperçu démo · {left}s
        </div>
      )}
      {!embedded && founder && (
        <button onClick={resetDemo} style={{ position: 'fixed', top: 18, right: 18, zIndex: 450, background: T.greenBg, color: T.green, border: `1px solid ${T.greenBorder}`, borderRadius: 18, padding: '7px 13px', fontFamily: FONT, fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>
          Accès fondateur
        </button>
      )}
      <DemoShell embedded={embedded}>
        {role === 'worker' ? (
          <WorkerDemo key={`worker-${demoVersion}`} founder={displayedFounder} onBack={returnToDemoChoice} accountName={labAccount?.role === 'worker' ? labAccount.name : undefined} />
        ) : (
          <StructureDemo key={`structure-${demoVersion}`} founder={displayedFounder} onBack={returnToDemoChoice} accountName={labAccount?.role === 'structure' ? labAccount.name : undefined} />
        )}
      </DemoShell>
      {frozen && <DemoLimitOverlay role={role} embedded={embedded} onFounder={openFounderArea} />}
    </>
  );
}
