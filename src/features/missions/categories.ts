// Catégories des missions solidaires (phase 0). Les mêmes clés sont utilisées
// par l'import API Engagement (supabase/functions/_shared/apiEngagement.ts).

export type SolidarityCategory =
  | 'aide_alimentaire'
  | 'evenementiel'
  | 'soutien_scolaire'
  | 'environnement'
  | 'solidarite'
  | 'sport'
  | 'culture'
  | 'sante'
  | 'autre';

export interface CategoryInfo {
  key: SolidarityCategory;
  label: string;
  glyph: string;
  // Dégradé de l'illustration UROSI utilisée quand aucune image n'existe.
  from: string;
  to: string;
  // Compétences typiquement mobilisées : alimentent le parcours et le CV.
  skills: string[];
}

export const CATEGORIES: CategoryInfo[] = [
  { key: 'aide_alimentaire', label: 'Aide alimentaire', glyph: '🥫', from: '#0e7490', to: '#16a34a', skills: ['Logistique', 'Travail en équipe', 'Accueil du public'] },
  { key: 'evenementiel', label: 'Événementiel', glyph: '🎪', from: '#7c3aed', to: '#db2777', skills: ['Organisation', 'Accueil du public', 'Travail en équipe'] },
  { key: 'soutien_scolaire', label: 'Soutien scolaire', glyph: '📚', from: '#2563eb', to: '#0891b2', skills: ['Pédagogie', 'Écoute', 'Communication'] },
  { key: 'environnement', label: 'Environnement', glyph: '🌱', from: '#15803d', to: '#65a30d', skills: ['Sensibilisation', 'Travail en équipe', 'Travail en extérieur'] },
  { key: 'solidarite', label: 'Solidarité', glyph: '🤝', from: '#b45309', to: '#dc2626', skills: ['Écoute', 'Accueil du public', 'Communication'] },
  { key: 'sport', label: 'Sport', glyph: '⚽', from: '#0369a1', to: '#4f46e5', skills: ['Animation', 'Travail en équipe', 'Organisation'] },
  { key: 'culture', label: 'Culture & loisirs', glyph: '🎭', from: '#be185d', to: '#9333ea', skills: ['Animation', 'Accueil du public', 'Communication'] },
  { key: 'sante', label: 'Santé & prévention', glyph: '🩺', from: '#0f766e', to: '#0284c7', skills: ['Écoute', 'Sensibilisation', 'Rigueur'] },
  { key: 'autre', label: 'Autre', glyph: '✨', from: '#1d4ed8', to: '#0891b2', skills: ['Travail en équipe'] },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

// Anciennes catégories des missions natives (avant phase 0) : conservées en
// base, simplement rattachées à la catégorie solidaire la plus proche.
const LEGACY: Record<string, SolidarityCategory> = {
  distribution: 'aide_alimentaire',
  accueil: 'solidarite',
  renfort_service: 'evenementiel',
  runner: 'evenementiel',
  inventaire: 'aide_alimentaire',
};

export function toCategory(value: string | null | undefined): SolidarityCategory {
  if (!value) return 'autre';
  if (BY_KEY.has(value as SolidarityCategory)) return value as SolidarityCategory;
  return LEGACY[value] ?? 'autre';
}

export function categoryInfo(value: string | null | undefined): CategoryInfo {
  return BY_KEY.get(toCategory(value)) ?? (CATEGORIES[CATEGORIES.length - 1] as CategoryInfo);
}

export const INTEREST_OPTIONS = CATEGORIES.filter((c) => c.key !== 'autre');
