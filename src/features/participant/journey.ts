// Logique pure du suivi de candidature et du parcours. Règle cardinale : une
// déclaration du participant n'est JAMAIS présentée comme une vérification.
import { categoryInfo, type SolidarityCategory } from '@/features/missions/categories';
import type { ExternalApplicationWithMission, ParticipantApplication, ParticipantRating } from './participantService';

export type StepState = 'done' | 'current' | 'upcoming' | 'stopped';

export interface TimelineStep {
  key: string;
  label: string;
  description: string;
  state: StepState;
  at: string | null;
  // true = information donnée par le participant, pas vérifiée par UROSI.
  declared: boolean;
}

export type Tone = 'info' | 'waiting' | 'success' | 'verified' | 'neutral' | 'danger';

export interface Headline {
  label: string;
  tone: Tone;
}

function dayOf(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Candidature externe (plateforme partenaire)
// ---------------------------------------------------------------------------
export function externalTimeline(app: ExternalApplicationWithMission, today: string): TimelineStep[] {
  const s = app.status;
  const accepted = s === 'accepted_declared' || s === 'completed_declared' || s === 'verified';
  const completed = s === 'completed_declared' || s === 'verified';
  const missionDay = dayOf(app.mission?.starts_at);
  const missionPassed = Boolean(missionDay && missionDay < today);
  const withdrawn = s === 'withdrawn';
  const later = (state: StepState): StepState => (withdrawn ? 'stopped' : state);

  return [
    {
      key: 'external',
      label: 'Candidature externe',
      description: 'Tu as été redirigé·e vers la plateforme partenaire pour candidater.',
      state: 'done',
      at: app.clicked_at,
      declared: false,
    },
    {
      key: 'waiting',
      label: withdrawn ? 'Candidature retirée' : 'En attente',
      description: withdrawn
        ? 'Tu as retiré cette candidature de ton suivi.'
        : 'Aucune confirmation reçue pour l’instant. La structure étudie ta candidature et te répond par email.',
      state: withdrawn ? 'stopped' : accepted ? 'done' : 'current',
      at: null,
      declared: false,
    },
    {
      key: 'accepted',
      label: 'Acceptée (déclarée)',
      description: accepted ? 'Tu as indiqué avoir été accepté·e par la structure.' : 'Indique-le ici quand la structure t’a confirmé ta participation.',
      state: later(accepted ? 'done' : 'upcoming'),
      at: app.accepted_declared_at,
      declared: true,
    },
    {
      key: 'planned',
      label: 'Mission prévue',
      description: missionDay ? 'La mission approche !' : 'La date est fixée avec la structure.',
      state: later(completed || (accepted && missionPassed) ? 'done' : accepted ? 'current' : 'upcoming'),
      at: app.mission?.starts_at ?? null,
      declared: false,
    },
    {
      key: 'completed',
      label: 'Mission réalisée (déclarée)',
      description: completed ? 'Tu as indiqué avoir réalisé cette mission.' : 'Après ta participation, indique-le pour l’ajouter à ton parcours.',
      state: later(completed ? 'done' : accepted && missionPassed ? 'current' : 'upcoming'),
      at: app.completed_declared_at,
      declared: true,
    },
    {
      key: 'verified',
      label: 'Expérience vérifiée',
      description:
        s === 'verified'
          ? 'UROSI a vérifié cette expérience : elle compte dans ton parcours vérifié.'
          : 'Une fois vérifiée par UROSI, cette expérience rejoindra ton parcours vérifié.',
      state: later(s === 'verified' ? 'done' : completed ? 'current' : 'upcoming'),
      at: app.verified_at,
      declared: false,
    },
  ];
}

export function externalHeadline(app: ExternalApplicationWithMission, today: string): Headline {
  switch (app.status) {
    case 'withdrawn':
      return { label: 'Retirée', tone: 'neutral' };
    case 'verified':
      return { label: 'Expérience vérifiée', tone: 'verified' };
    case 'completed_declared':
      return { label: 'Réalisée · déclarée', tone: 'success' };
    case 'accepted_declared': {
      const day = dayOf(app.mission?.starts_at);
      return day && day < today ? { label: 'Réalisée ?', tone: 'info' } : { label: 'Mission prévue', tone: 'success' };
    }
    default:
      return { label: 'En attente', tone: 'waiting' };
  }
}

// ---------------------------------------------------------------------------
// Candidature interne (mission native UROSI)
// ---------------------------------------------------------------------------
function nativeEnded(app: ParticipantApplication): boolean {
  return app.attendance_status === 'end_confirmed' || app.cv_status != null || app.status === 'completed' || app.status === 'payment_pending';
}

function nativeVerified(app: ParticipantApplication): boolean {
  // Lignes 'completed' antérieures au statut CV : déjà considérées vérifiées.
  return app.cv_status === 'verified' || (app.cv_status == null && app.status === 'completed');
}

export function nativeTimeline(app: ParticipantApplication, today: string): TimelineStep[] {
  const rejected = app.status === 'rejected';
  const cancelled = app.status === 'cancelled';
  const stopped = rejected || cancelled;
  const accepted = ['accepted', 'in_progress', 'payment_pending', 'completed'].includes(app.status) || nativeEnded(app);
  const ended = nativeEnded(app);
  const verified = nativeVerified(app);
  const missionDay = app.mission?.scheduled_date ?? null;
  const later = (state: StepState): StepState => (stopped ? 'stopped' : state);

  return [
    { key: 'sent', label: 'Candidature envoyée', description: 'La structure a reçu ta candidature sur UROSI.', state: 'done', at: app.created_at, declared: false },
    {
      key: 'waiting',
      label: rejected ? 'Candidature non retenue' : cancelled ? 'Candidature annulée' : 'En attente',
      description: rejected
        ? 'La structure n’a pas retenu ta candidature cette fois-ci. D’autres missions t’attendent.'
        : cancelled
          ? 'Cette candidature a été annulée, sans conséquence pour toi.'
          : 'La structure étudie ta candidature. Tu seras prévenu·e dès qu’elle répond.',
      state: stopped ? 'stopped' : accepted ? 'done' : 'current',
      at: null,
      declared: false,
    },
    {
      key: 'accepted',
      label: 'Acceptée par la structure',
      description: 'Confirmé par la structure sur UROSI.',
      state: later(accepted ? 'done' : 'upcoming'),
      at: null,
      declared: false,
    },
    {
      key: 'planned',
      label: 'Mission prévue',
      description: missionDay ? 'La mission approche !' : 'La date est fixée avec la structure.',
      state: later(ended || (accepted && missionDay != null && missionDay < today) ? 'done' : accepted ? 'current' : 'upcoming'),
      at: missionDay,
      declared: false,
    },
    {
      key: 'completed',
      label: 'Participation confirmée',
      description: 'La structure a confirmé ta participation.',
      state: later(ended ? 'done' : 'upcoming'),
      at: app.actual_end_at,
      declared: false,
    },
    {
      key: 'verified',
      label: 'Expérience vérifiée',
      description:
        app.cv_status === 'disputed'
          ? `Contestée par la structure${app.cv_status_reason ? ` : ${app.cv_status_reason}` : ''}.`
          : app.cv_status === 'rejected'
            ? 'Cette expérience n’a pas pu être vérifiée.'
            : verified
              ? 'Expérience vérifiée : elle compte dans ton parcours.'
              : 'Validée par la structure, ou automatiquement 48 h après la mission sans contestation.',
      state: later(verified ? 'done' : ended ? 'current' : 'upcoming'),
      at: app.cv_verified_at,
      declared: false,
    },
  ];
}

export function nativeHeadline(app: ParticipantApplication): Headline {
  if (app.status === 'rejected') return { label: 'Non retenue', tone: 'neutral' };
  if (app.status === 'cancelled') return { label: 'Annulée', tone: 'neutral' };
  if (app.cv_status === 'disputed') return { label: 'Contestée', tone: 'danger' };
  if (nativeVerified(app)) return { label: 'Expérience vérifiée', tone: 'verified' };
  if (nativeEnded(app)) return { label: 'Réalisée', tone: 'success' };
  if (app.status === 'in_progress') return { label: 'En cours', tone: 'success' };
  if (app.status === 'accepted') return { label: 'Acceptée', tone: 'success' };
  return { label: 'En attente', tone: 'waiting' };
}

// ---------------------------------------------------------------------------
// Parcours / CV
// ---------------------------------------------------------------------------
export interface Experience {
  key: string;
  origin: 'urosi' | 'external';
  title: string;
  organization: string;
  date: string | null;
  minutes: number | null;
  city: string | null;
  category: SolidarityCategory;
  skills: string[];
  verified: boolean;
  structureComment: string | null;
  structureScore: number | null;
}

function nativeMinutes(app: ParticipantApplication): number | null {
  if (app.actual_start_at && app.actual_end_at) {
    const m = Math.round((Date.parse(app.actual_end_at) - Date.parse(app.actual_start_at)) / 60000);
    if (m > 0) return m;
  }
  return app.mission?.duration_minutes || null;
}

export function buildExperiences(
  native: ParticipantApplication[],
  external: ExternalApplicationWithMission[],
  ratings: ParticipantRating[],
): Experience[] {
  const received = new Map(
    ratings.filter((r) => r.direction === 'structure_to_worker' && r.status === 'published').map((r) => [r.application_id, r]),
  );

  const fromNative: Experience[] = native
    .filter((a) => nativeEnded(a) && a.cv_status !== 'rejected' && a.status !== 'cancelled')
    .map((a) => {
      const category = categoryInfo(a.mission?.mission_category);
      const rating = received.get(a.id);
      return {
        key: `urosi:${a.id}`,
        origin: 'urosi',
        title: a.mission?.title ?? 'Mission',
        organization: a.mission?.structure?.trade_name || a.mission?.structure?.name || 'Structure UROSI',
        date: a.mission?.scheduled_date ?? dayOf(a.actual_end_at),
        minutes: nativeMinutes(a),
        city: a.mission?.city ?? null,
        category: category.key,
        skills: category.skills,
        verified: nativeVerified(a),
        structureComment: rating?.comment ?? null,
        structureScore: rating?.score ?? null,
      };
    });

  const fromExternal: Experience[] = external
    .filter((a) => a.status === 'completed_declared' || a.status === 'verified')
    .map((a) => {
      const category = categoryInfo(a.mission?.category);
      return {
        key: `external:${a.id}`,
        origin: 'external',
        title: a.mission?.title ?? 'Mission solidaire',
        organization: a.mission?.organization_name || 'Association partenaire',
        date: dayOf(a.mission?.starts_at) ?? dayOf(a.completed_declared_at),
        minutes: a.declared_minutes ?? a.mission?.duration_minutes ?? null,
        city: a.mission?.city ?? null,
        category: category.key,
        skills: category.skills,
        verified: a.status === 'verified',
        structureComment: a.status === 'verified' ? a.verification_note : null,
        structureScore: null,
      };
    });

  return [...fromNative, ...fromExternal].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

export interface JourneySummary {
  missions: number;
  minutes: number;
  structures: number;
  declaredPending: number;
  reviewsReceived: number;
  averageReceived: number | null;
  domains: Array<{ category: SolidarityCategory; label: string; count: number }>;
  skills: string[];
}

// Les chiffres mis en avant ne comptent QUE les expériences vérifiées ; les
// déclarations sont comptées à part, jamais additionnées en silence.
export function summarize(experiences: Experience[], ratings: ParticipantRating[], profileSkills: string[] = []): JourneySummary {
  const verified = experiences.filter((e) => e.verified);
  const received = ratings.filter((r) => r.direction === 'structure_to_worker' && r.status === 'published');
  const domainCounts = new Map<SolidarityCategory, number>();
  for (const e of experiences) domainCounts.set(e.category, (domainCounts.get(e.category) ?? 0) + 1);
  const skills = new Set<string>(profileSkills.map((s) => s.trim()).filter(Boolean));
  for (const e of verified) e.skills.forEach((s) => skills.add(s));

  return {
    missions: verified.length,
    minutes: verified.reduce((sum, e) => sum + (e.minutes ?? 0), 0),
    structures: new Set(verified.map((e) => e.organization.toLowerCase())).size,
    declaredPending: experiences.length - verified.length,
    reviewsReceived: received.length,
    averageReceived: received.length ? received.reduce((s, r) => s + r.score, 0) / received.length : null,
    domains: [...domainCounts.entries()]
      .map(([category, count]) => ({ category, label: categoryInfo(category).label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr')),
    skills: [...skills],
  };
}

export function formatEngagementHours(minutes: number): string {
  if (minutes <= 0) return '0 h';
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1).replace('.', ',')} h`;
}
