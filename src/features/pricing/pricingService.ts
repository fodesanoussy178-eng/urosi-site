import { supabase } from '@/lib/supabase';
import type { Database, PayRuleKind, PricingBreakdown, Json } from '@/types/database.types';

export type PayRule = Database['public']['Tables']['pay_rules']['Row'];
export type PayRuleInsert = Database['public']['Tables']['pay_rules']['Insert'];

// Metadonnees d'affichage des types de regles (dashboard Structure).
export const RULE_KINDS: Record<PayRuleKind, { label: string; hint: string }> = {
  day_of_week: { label: 'Jour de la semaine', hint: 'Majoration selon le jour (ex. week-end).' },
  holiday: { label: 'Jour férié', hint: 'S’applique automatiquement les jours fériés français.' },
  time_of_day: { label: 'Plage horaire', hint: 'Soir, nuit ou matin selon l’heure de début.' },
  duration: { label: 'Durée', hint: 'S’applique aux missions longues (durée minimale).' },
  sector: { label: 'Secteur', hint: 'S’applique aux missions de certains secteurs.' },
  difficulty: { label: 'Difficulté', hint: 'S’applique à partir d’un niveau de difficulté.' },
  urgency: { label: 'Urgence', hint: 'S’applique aux missions marquées urgentes.' },
  distance: { label: 'Distance', hint: 'S’applique aux sites éloignés (km minimum).' },
  tension: { label: 'Tension offre/demande', hint: 'S’applique quand les missions du secteur trouvent peu de candidats.' },
  custom: { label: 'Bonus structure', hint: 'Bonus appliqué à toutes tes missions.' },
};

// Modeles proposes en un clic dans le dashboard Structure.
export const RULE_TEMPLATES: Array<Omit<PayRuleInsert, 'structure_id'>> = [
  { kind: 'day_of_week', label: 'Majoration week-end', params: { days: [6, 7] }, adjust_pct: 20 },
  { kind: 'holiday', label: 'Majoration jour férié', params: {}, adjust_pct: 50 },
  { kind: 'time_of_day', label: 'Majoration nuit (21h-6h)', params: { from: '21:00', to: '06:00' }, adjust_pct: 25 },
  { kind: 'time_of_day', label: 'Majoration tôt le matin (5h-8h)', params: { from: '05:00', to: '08:00' }, adjust_pct: 10 },
  { kind: 'duration', label: 'Mission longue (4h et +)', params: { min_minutes: 240 }, adjust_cents: 500 },
  { kind: 'difficulty', label: 'Difficulté élevée', params: { min_level: 3 }, adjust_pct: 10 },
  { kind: 'urgency', label: 'Mission urgente', params: {}, adjust_pct: 15 },
  { kind: 'distance', label: 'Site éloigné (10 km et +)', params: { min_km: 10 }, adjust_cents: 300 },
  { kind: 'tension', label: 'Secteur en tension', params: { min_ratio: 2 }, adjust_pct: 10 },
  { kind: 'custom', label: 'Bonus qualité', params: {}, adjust_cents: 200 },
];

export async function fetchPayRules(structureId: string): Promise<PayRule[]> {
  const { data, error } = await supabase
    .from('pay_rules')
    .select('*')
    .eq('structure_id', structureId)
    .order('priority')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function createPayRule(rule: PayRuleInsert): Promise<PayRule> {
  const { data, error } = await supabase.from('pay_rules').insert(rule).select('*').single();
  if (error) throw error;
  return data;
}

export async function togglePayRule(ruleId: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('pay_rules').update({ active }).eq('id', ruleId);
  if (error) throw error;
}

export async function deletePayRule(ruleId: string): Promise<void> {
  const { error } = await supabase.from('pay_rules').delete().eq('id', ruleId);
  if (error) throw error;
}

export interface PricingPreviewInput {
  structureId: string;
  baseCents: number;
  date: string;
  startTime?: string | null;
  durationMinutes: number;
  sector: string;
  difficulty: number;
  urgent: boolean;
  distanceKm?: number | null;
}

// Apercu live de la remuneration finale (meme moteur SQL que le trigger de
// publication : aucun ecart possible entre l'apercu et le montant publie).
export async function previewPricing(input: PricingPreviewInput): Promise<PricingBreakdown> {
  const { data, error } = await supabase.rpc('compute_mission_pricing', {
    p_structure_id: input.structureId,
    p_base_cents: input.baseCents,
    p_date: input.date,
    p_start_time: input.startTime ?? undefined,
    p_duration_minutes: input.durationMinutes,
    p_sector: input.sector,
    p_difficulty: input.difficulty,
    p_urgent: input.urgent,
    p_distance_km: input.distanceKm ?? undefined,
  });
  if (error) throw error;
  return data as unknown as PricingBreakdown;
}

export function ruleParamsSummary(kind: PayRuleKind, params: Json): string {
  const p = (params ?? {}) as Record<string, Json>;
  switch (kind) {
    case 'day_of_week': {
      const names = ['', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
      const days = Array.isArray(p.days) ? (p.days as number[]) : [];
      return days.map((d) => names[d] ?? '?').join(', ');
    }
    case 'time_of_day':
      return `${p.from ?? '21:00'} → ${p.to ?? '06:00'}`;
    case 'duration':
      return `dès ${Math.round(Number(p.min_minutes ?? 240) / 60)} h`;
    case 'sector':
      return Array.isArray(p.sectors) ? (p.sectors as string[]).join(', ') : '';
    case 'difficulty':
      return `niveau ${p.min_level ?? 3}+`;
    case 'distance':
      return `dès ${p.min_km ?? 10} km`;
    case 'tension':
      return `ratio ≥ ${p.min_ratio ?? 2}`;
    default:
      return '';
  }
}
