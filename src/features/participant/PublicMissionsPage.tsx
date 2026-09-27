// Catalogue public (/missions) : « il y a déjà des choses que je peux faire
// autour de moi », avant même de créer un compte. Jamais vide, jamais bloqué :
// missions réelles, sinon missions d'exemple clairement signalées.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CATEGORIES, type SolidarityCategory } from '@/features/missions/categories';
import { matchesSearch, missionDistance, sortFeed } from '@/features/missions/solidarityMissions';
import { geocodeMelCity } from '@/lib/geo';
import { PublicShell } from '@/components/public/PublicShell';
import { PublicMissionCard } from '@/components/public/PublicMissionCard';
import { Icon } from '@/components/public/icons';
import { useFavorites } from './hooks';
import { MEL_CITIES, usePublicCatalog } from './publicCatalog';

function SkeletonCard() {
  return (
    <div className="m-card" aria-hidden="true">
      <div className="m-card-visual" style={{ background: 'linear-gradient(90deg,#eef3fb,#f6f9fe,#eef3fb)' }} />
      <div className="m-card-body">
        <div style={{ height: 16, width: '75%', borderRadius: 6, background: '#eef3fb' }} />
        <div style={{ height: 12, width: '45%', borderRadius: 6, background: '#f1f5fb' }} />
        <div style={{ height: 12, width: '60%', borderRadius: 6, background: '#f1f5fb' }} />
      </div>
    </div>
  );
}

export function PublicMissionsPage() {
  const nav = useNavigate();
  const { catalog, loading } = usePublicCatalog();
  const { favorites, toggleFavorite } = useFavorites(null);
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('Lille');
  const [category, setCategory] = useState<SolidarityCategory | 'all'>('all');
  const position = useMemo(() => geocodeMelCity(city), [city]);

  const missions = catalog?.missions ?? [];
  const available = useMemo(() => new Set(missions.map((m) => m.category)), [missions]);
  const visible = useMemo(
    () => sortFeed(missions.filter((m) => (category === 'all' || m.category === category) && matchesSearch(m, query)), position),
    [missions, category, query, position],
  );

  return (
    <PublicShell active="missions">
      <div className="pub-wrap" style={{ paddingTop: 30 }}>
        <span className="pub-kicker">Missions solidaires · Métropole de Lille</span>
        <h1 className="pub-h1">Trouve une mission solidaire</h1>
        <p className="pub-lede">Des missions courtes pour agir près de chez toi et enrichir ton parcours.</p>

        <form className="pub-searchbar" role="search" onSubmit={(e) => e.preventDefault()}>
          <label style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#7b8aa1' }}><Icon name="search" size={18} /></span>
            <input className="pub-input" style={{ paddingLeft: 42 }} aria-label="Rechercher une mission" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une mission, une association…" />
          </label>
          <label style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#7b8aa1' }}><Icon name="pin" size={17} /></span>
            <select className="pub-input" style={{ paddingLeft: 36, appearance: 'auto' }} aria-label="Ville" value={city} onChange={(e) => setCity(e.target.value)}>
              {MEL_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button type="submit" className="pub-btn pub-btn-primary pub-search-go" aria-label="Rechercher" style={{ minHeight: 48, padding: '0 16px' }}><Icon name="search" size={18} /></button>
        </form>

        <div className="pub-chips" role="tablist" aria-label="Catégories">
          {[{ key: 'all' as const, label: 'Toutes' }, ...CATEGORIES.filter((c) => c.key !== 'autre' && (available.size === 0 || available.has(c.key)))].map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={category === c.key} className="pub-chip" onClick={() => setCategory(c.key)}>
              {c.label}
            </button>
          ))}
        </div>

        {catalog?.demo && (
          <div className="pub-notice" role="note">
            <Icon name="sparkles" size={18} color="#1d5fe6" />
            <span>Aperçu du catalogue : ces missions sont des <strong>exemples</strong>. Les premières missions de la métropole arrivent très bientôt — crée ton compte pour être prévenu·e.</span>
          </div>
        )}

        <div className="pub-grid" aria-busy={loading}>
          {loading && Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
          {!loading &&
            visible.map((m) => (
              <PublicMissionCard
                key={m.key}
                mission={m}
                distance={missionDistance(m, position)}
                favorite={favorites.has(m.key)}
                onToggleFavorite={() => toggleFavorite(m.key)}
                onOpen={() => nav(`/missions/${encodeURIComponent(m.key)}`)}
              />
            ))}
        </div>

        {!loading && visible.length === 0 && (
          <div className="pub-card" style={{ padding: '34px 22px', textAlign: 'center', marginTop: 8 }}>
            <div style={{ display: 'inline-flex', width: 52, height: 52, borderRadius: 16, background: '#e8f0ff', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Icon name="search" size={24} color="#1d5fe6" />
            </div>
            <div style={{ fontSize: 17, fontWeight: 900 }}>{missions.length === 0 ? 'Les premières missions arrivent' : 'Aucune mission ne correspond'}</div>
            <p className="pub-lede" style={{ fontSize: 14, marginTop: 6 }}>
              {missions.length === 0 ? 'De nouvelles missions solidaires sont ajoutées très régulièrement autour de Lille.' : 'Essaie une autre catégorie ou un autre mot-clé.'}
            </p>
            {missions.length > 0 && (
              <button type="button" className="pub-btn pub-btn-ghost" style={{ marginTop: 14 }} onClick={() => { setQuery(''); setCategory('all'); }}>
                Voir toutes les missions
              </button>
            )}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
