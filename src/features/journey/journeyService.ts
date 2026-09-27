// Données du parcours Phase 0 : candidater → dire si j'y suis allé → la
// structure confirme → le profil. Tout passe par des fonctions SQL dédiées
// (migration 20260928120000) : le navigateur n'écrit jamais un statut.
import { supabase } from '@/lib/supabase';
import { addDays, localClicks, markSynced, visitorId } from './visitor';

export type JourneyKind = 'external' | 'urosi';

// État vu par le participant, sans jargon :
//   applied    candidature faite, mission pas encore passée ;
//   ask        mission passée : « Alors, ta mission ? » ;
//   declared   « J'y suis allé » : en attente de confirmation ;
//   verified   la structure a confirmé (pastille verte) ;
//   closed     « Je n'y suis pas allé », ou la structure n'a pas confirmé.
export type JourneyState = 'applied' | 'ask' | 'declared' | 'verified' | 'closed';

export interface JourneyItem {
  key: string;
  kind: JourneyKind;
  missionId: string;
  title: string;
  organization: string;
  date: string | null;
  askAfter: string;
  minutes: number | null;
  state: JourneyState;
}

export interface ExternalRow {
  external_mission_id: string;
  status: string;
  clicked_at: string;
  mission_date: string | null;
  organization_name: string | null;
  declared_minutes: number | null;
  mission: { title: string; organization_name: string | null; starts_at: string | null; duration_minutes: number | null } | null;
}

export interface NativeRow {
  mission_id: string;
  status: string;
  cv_status: string | null;
  participant_declared_completed: boolean | null;
  mission: {
    title: string;
    scheduled_date: string;
    duration_minutes: number | null;
    structure: { name: string; trade_name: string | null } | null;
  } | null;
}

function parisDay(iso: string): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function externalItem(row: ExternalRow, today: string): JourneyItem {
  const date = row.mission_date ?? (row.mission?.starts_at ? parisDay(row.mission.starts_at) : null);
  // Mission sans date précise : on demande une semaine après le clic.
  const askAfter = date ?? addDays(parisDay(row.clicked_at), 7);
  let state: JourneyState;
  switch (row.status) {
    case 'verified_completed':
    case 'verified':
      state = 'verified';
      break;
    case 'completed_declared':
      state = 'declared';
      break;
    case 'not_done_declared':
    case 'not_confirmed':
    case 'withdrawn':
      state = 'closed';
      break;
    default:
      state = askAfter < today ? 'ask' : 'applied';
  }
  return {
    key: `external:${row.external_mission_id}`,
    kind: 'external',
    missionId: row.external_mission_id,
    title: row.mission?.title ?? 'Mission solidaire',
    organization: row.organization_name ?? row.mission?.organization_name ?? 'Association',
    date,
    askAfter,
    minutes: row.declared_minutes ?? row.mission?.duration_minutes ?? null,
    state,
  };
}

export function nativeItem(row: NativeRow, today: string): JourneyItem | null {
  if (!row.mission || ['cancelled', 'rejected'].includes(row.status)) return null;
  const date = row.mission.scheduled_date;
  let state: JourneyState;
  if (row.cv_status === 'verified') state = 'verified';
  else if (row.participant_declared_completed === false || row.cv_status === 'disputed' || row.cv_status === 'rejected') state = 'closed';
  else if (row.participant_declared_completed === true) state = 'declared';
  // On ne demande « Alors ? » que si la structure avait retenu la candidature.
  else if (['accepted', 'in_progress', 'completed', 'payment_pending'].includes(row.status) && date < today) state = 'ask';
  else if (row.status === 'pending' && date < today) return null;
  else state = 'applied';
  return {
    key: `urosi:${row.mission_id}`,
    kind: 'urosi',
    missionId: row.mission_id,
    title: row.mission.title,
    organization: row.mission.structure?.trade_name || row.mission.structure?.name || 'Structure',
    date,
    askAfter: date,
    minutes: row.mission.duration_minutes,
    state,
  };
}

function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || /does not exist|schema cache/i.test(error.message ?? '');
}

export async function fetchMyJourney(userId: string, today: string): Promise<JourneyItem[]> {
  const [ext, nat] = await Promise.all([
    supabase
      .from('external_applications')
      .select('external_mission_id, status, clicked_at, mission_date, organization_name, declared_minutes, mission:external_missions(title, organization_name, starts_at, duration_minutes)')
      .eq('user_id', userId)
      .order('clicked_at', { ascending: false }),
    supabase
      .from('applications')
      .select('mission_id, status, cv_status, participant_declared_completed, mission:missions(title, scheduled_date, duration_minutes, structure:structures(name, trade_name))')
      .eq('worker_id', userId)
      .order('created_at', { ascending: false }),
  ]);
  if (ext.error && !isMissingRelation(ext.error)) throw ext.error;
  if (nat.error && !isMissingRelation(nat.error)) throw nat.error;
  const external = ((ext.data ?? []) as unknown as ExternalRow[]).map((r) => externalItem(r, today));
  const native = ((nat.data ?? []) as unknown as NativeRow[]).map((r) => nativeItem(r, today)).filter((i): i is JourneyItem => Boolean(i));
  return [...external, ...native];
}

// Comportement 3 : enregistre le clic (connecté ou non). Ne lève jamais :
// la redirection vers l'annonceur ne doit pas en dépendre.
export async function recordClick(externalMissionId: string): Promise<void> {
  try {
    await supabase.rpc('record_application_click', { p_external_mission_id: externalMissionId, p_visitor_id: visitorId() });
  } catch {
    // réseau indisponible : la candidature continue chez l'annonceur
  }
}

// Comportement 4.
export async function declareParticipation(kind: JourneyKind, missionId: string, went: boolean): Promise<void> {
  const { error } = await supabase.rpc('declare_participation', { p_kind: kind, p_mission_id: missionId, p_went: went });
  if (error) throw error;
}

// Après connexion : les candidatures faites en visiteur rejoignent le compte,
// et les réponses déjà données sur l'appareil sont transmises.
export async function syncVisitorJourney(): Promise<void> {
  const clicks = localClicks();
  if (clicks.length === 0) return;
  await supabase.rpc('claim_visitor_clicks', { p_visitor_id: visitorId() });
  const answered = clicks.filter((c) => c.answer && !c.synced);
  const done: string[] = [];
  for (const c of answered) {
    try {
      await declareParticipation('external', c.missionId, c.answer === 'went');
      done.push(c.key);
    } catch {
      // mission pas encore passée ou déjà traitée : on réessaiera
    }
  }
  if (done.length > 0) markSynced(done);
}

// Comportement 5 (structure externe, sans compte).
export interface ParticipationRequest {
  participant: string;
  mission_title: string;
  organization_name: string | null;
  mission_date: string | null;
  city: string | null;
  answer: 'confirmed' | 'denied' | null;
}

export async function fetchParticipationRequest(token: string): Promise<ParticipationRequest | null> {
  const { data, error } = await supabase.rpc('get_participation_request', { p_token: token });
  if (error) throw error;
  return (data as unknown as ParticipationRequest | null) ?? null;
}

export async function answerParticipationRequest(token: string, confirmed: boolean): Promise<'confirmed' | 'denied'> {
  const { data, error } = await supabase.rpc('answer_participation_request', { p_token: token, p_confirmed: confirmed });
  if (error) throw error;
  return data as 'confirmed' | 'denied';
}

// Profil public.
export interface PublicProfile {
  name: string;
  city: string | null;
  avatar_url: string | null;
  missions: number;
  minutes: number;
  experiences: Array<{ title: string; organization: string; day: string | null; minutes: number | null }>;
}

export async function fetchPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.rpc('public_participant_profile', { p_user_id: userId });
  if (error) throw error;
  return (data as unknown as PublicProfile | null) ?? null;
}

export async function setProfileVisibility(userId: string, visible: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ public_profile: visible } as never).eq('id', userId);
  if (error) throw error;
}

export async function updateProfileCity(userId: string, city: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ city }).eq('id', userId);
  if (error) throw error;
}

// « Hugo M. »
export function displayName(fullName: string | null | undefined, publicFirstName?: string | null): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  const first = (publicFirstName ?? '').trim() || parts[0] || 'Bénévole';
  const initial = parts.length > 1 ? `${parts[parts.length - 1]!.charAt(0).toUpperCase()}.` : '';
  return `${first} ${initial}`.trim();
}
