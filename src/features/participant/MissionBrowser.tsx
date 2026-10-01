import { useMemo, useState } from 'react';
import { T } from '@/components/ui/theme';
import { CATEGORIES, type SolidarityCategory } from '@/features/missions/categories';
import { matchesSearch, missionDistance, sortFeed, type FeedMission } from '@/features/missions/solidarityMissions';
import type { LatLng } from '@/lib/geo';
import { EmptyState, FeedMissionCard } from './ParticipantUi';

export function CategoryChips({
  value,
  onChange,
  available,
  first = [],
}: {
  value: SolidarityCategory | 'all';
  onChange: (value: SolidarityCategory | 'all') => void;
  available?: Set<SolidarityCategory>;
  first?: string[];
}) {
  const ordered = [...CATEGORIES]
    .filter((c) => !available || available.has(c.key))
    .sort((a, b) => Number(first.includes(b.key)) - Number(first.includes(a.key)));
  return (
    <div role="tablist" aria-label="Catégories" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
      {[{ key: 'all' as const, label: 'Tous' }, ...ordered].map((c) => {
        const on = value === c.key;
        return (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(c.key)}
            style={{ flexShrink: 0, border: `1px solid ${on ? T.text : T.cb}`, background: on ? T.text : T.card, color: on ? T.bg : T.sub, borderRadius: 999, padding: '7px 13px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

export function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '0 12px' }}>
      <span aria-hidden="true" style={{ color: T.mu, fontSize: 13 }}>⌕</span>
      <input
        aria-label="Rechercher une mission"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Rechercher une mission, une structure, une ville…"
        style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: T.text, fontSize: 12.5, padding: '11px 0' }}
      />
      {value && (
        <button type="button" aria-label="Effacer la recherche" onClick={() => onChange('')} style={{ background: 'none', border: 'none', color: T.mu, cursor: 'pointer', fontSize: 14 }}>
          ×
        </button>
      )}
    </label>
  );
}

export function MissionBrowser({
  missions,
  loading,
  position,
  favorites,
  onToggleFavorite,
  onOpen,
  interests = [],
  initialQuery = '',
  initialCategory = 'all',
}: {
  missions: FeedMission[];
  loading: boolean;
  position: LatLng | null;
  favorites: Set<string>;
  onToggleFavorite: (key: string) => void;
  onOpen: (mission: FeedMission) => void;
  interests?: string[];
  initialQuery?: string;
  initialCategory?: SolidarityCategory | 'all';
}) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<SolidarityCategory | 'all'>(initialCategory);
  const available = useMemo(() => new Set(missions.map((m) => m.category)), [missions]);
  const visible = useMemo(
    () => sortFeed(missions.filter((m) => (category === 'all' || m.category === category) && matchesSearch(m, query)), position),
    [missions, category, query, position],
  );

  return (
    <div style={{ display: 'grid', gap: 11 }}>
      <SearchField value={query} onChange={setQuery} />
      {available.size > 1 && <CategoryChips value={category} onChange={setCategory} available={available} first={interests} />}
      {loading && <div style={{ fontSize: 11.5, color: T.mu, textAlign: 'center', padding: 18 }}>Chargement des missions…</div>}
      {!loading && visible.length === 0 && (
        <EmptyState icon="🔎" title={missions.length === 0 ? 'Les premières missions arrivent' : 'Aucune mission ne correspond'}>
          {missions.length === 0
            ? 'De nouvelles missions solidaires sont ajoutées très régulièrement autour de Lille. Reviens bientôt !'
            : 'Essaie une autre catégorie ou un autre mot-clé.'}
        </EmptyState>
      )}
      {visible.map((m) => (
        <FeedMissionCard
          key={m.key}
          mission={m}
          distance={missionDistance(m, position)}
          favorite={favorites.has(m.key)}
          onToggleFavorite={() => onToggleFavorite(m.key)}
          onOpen={() => onOpen(m)}
        />
      ))}
    </div>
  );
}
