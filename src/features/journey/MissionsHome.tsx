// Comportement 1 : j'arrive → je vois des missions.
// Localisation demandée d'emblée ; si refusée, seulement la ville. En haut :
// « 📍 Près de moi » et « Voir dans ma ville ». Rien d'autre à régler.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicShell } from '@/components/public/PublicShell';
import { useAuth } from '@/features/auth/AuthContext';
import { usePublicCatalog } from '@/features/participant/publicCatalog';
import { AfterMissionCard, type AfterMissionQuestion } from './AfterMissionCard';
import { todayIso } from './format';
import { declareParticipation, fetchMyJourney, type JourneyItem } from './journeyService';
import { KNOWN_COMMUNES, missionsInCity, missionsNearMe, useUserLocation } from './location';
import { MissionCard, MissionCardSkeleton } from './MissionCard';
import { answerLocalClick, pendingLocalQuestions } from './visitor';

type Mode = 'near' | 'city';

function useQuestions(userId: string | null) {
  const [questions, setQuestions] = useState<Array<AfterMissionQuestion & { item?: JourneyItem }>>([]);
  const load = useCallback(async () => {
    const today = todayIso();
    if (userId) {
      const items = await fetchMyJourney(userId, today).catch(() => [] as JourneyItem[]);
      setQuestions(items.filter((i) => i.state === 'ask').map((i) => ({ key: i.key, title: i.title, organization: i.organization, date: i.date, item: i })));
    } else {
      setQuestions(pendingLocalQuestions(today).map((c) => ({ key: c.key, title: c.title, organization: c.organization, date: c.askAfter })));
    }
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { questions, setQuestions };
}

export function MissionsHome() {
  const nav = useNavigate();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { catalog, loading } = usePublicCatalog();
  const { location, phase, askGps, chooseCity, changeCity } = useUserLocation();
  const [mode, setMode] = useState<Mode>('near');
  const [cityInput, setCityInput] = useState('');
  const [cityError, setCityError] = useState<string | null>(null);
  const { questions, setQuestions } = useQuestions(userId);

  const missions = catalog?.missions ?? [];
  const list = useMemo(() => {
    if (phase !== 'ready' || !location) {
      return missions
        .slice()
        .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
        .map((mission) => ({ mission, distance: null as number | null }));
    }
    const ranked = mode === 'city' ? missionsInCity(missions, location.city, location) : missionsNearMe(missions, location);
    // Distance affichée seulement si elle est réelle (position GPS) : depuis
    // une ville choisie, on trie par proximité du centre sans l'afficher.
    return location.source === 'gps' ? ranked : ranked.map((x) => ({ ...x, distance: null }));
  }, [missions, phase, location, mode]);

  async function submitCity(e: FormEvent) {
    e.preventDefault();
    if (!cityInput.trim()) return;
    setCityError(null);
    const ok = await chooseCity(cityInput);
    if (!ok) setCityError('Ville introuvable. Vérifie l’orthographe.');
    else setMode('near');
  }

  async function answer(q: AfterMissionQuestion & { item?: JourneyItem }, went: boolean) {
    if (q.item) await declareParticipation(q.item.kind, q.item.missionId, went);
    else answerLocalClick(q.key, went ? 'went' : 'not_went');
    if (!went) setQuestions((list) => list.filter((x) => x.key !== q.key));
  }

  const question = questions[0];

  return (
    <PublicShell active="missions">
      <div className="pub-wrap j-home">
        {question && <AfterMissionCard key={question.key} question={question} anonymous={!userId} onAnswer={(went) => answer(question, went)} />}

        <h1 className="j-title">Missions près de toi</h1>

        {phase === 'asking' && (
          <div className="j-locate" role="status">
            <span className="j-pulse" aria-hidden="true">📍</span>
            <span>Autorise la localisation pour voir les missions autour de toi.</span>
            <button type="button" className="pub-btn pub-btn-quiet" onClick={changeCity}>Choisir ma ville</button>
          </div>
        )}

        {phase === 'need_city' && (
          <form className="j-city-form" onSubmit={submitCity}>
            <label htmlFor="j-city">Dans quelle ville cherches-tu ?</label>
            <div className="j-city-row">
              <input id="j-city" className="pub-input" list="j-cities" value={cityInput} onChange={(e) => setCityInput(e.target.value)} placeholder="Ex. Lille" autoComplete="address-level2" autoFocus />
              <button type="submit" className="pub-btn pub-btn-primary">Voir les missions</button>
            </div>
            <datalist id="j-cities">{KNOWN_COMMUNES.map((c) => <option key={c.name} value={c.name} />)}</datalist>
            {cityError && <p className="j-error" role="alert">{cityError}</p>}
            {location && <button type="button" className="pub-btn pub-btn-quiet" onClick={askGps}>Utiliser ma position</button>}
          </form>
        )}

        {phase === 'ready' && location && (
          <div className="j-modes">
            <button type="button" className="j-place" onClick={changeCity} aria-label={`Ville : ${location.city}. Changer de ville`}>
              📍 {location.city}
            </button>
            <div className="j-seg" role="tablist" aria-label="Zone">
              <button type="button" role="tab" aria-selected={mode === 'near'} onClick={() => setMode('near')}>
                Près de moi
              </button>
              <button type="button" role="tab" aria-selected={mode === 'city'} onClick={() => setMode('city')}>
                Voir dans ma ville
              </button>
            </div>
          </div>
        )}

        {catalog?.demo && <p className="j-demo-note">Exemples de missions : les vraies missions de la métropole arrivent très bientôt.</p>}

        <div className="pub-grid" aria-busy={loading}>
          {loading && Array.from({ length: 6 }, (_, i) => <MissionCardSkeleton key={i} />)}
          {!loading && list.map(({ mission, distance }) => (
            <MissionCard key={mission.key} mission={mission} distance={distance} onOpen={() => nav(`/missions/${encodeURIComponent(mission.key)}`)} />
          ))}
        </div>

        {!loading && list.length === 0 && (
          <div className="j-empty">
            {mode === 'city' && location ? (
              <>
                <p>Aucune mission à {location.city} pour le moment.</p>
                <button type="button" className="pub-btn pub-btn-primary" onClick={() => setMode('near')}>Voir les missions proches</button>
              </>
            ) : (
              <p>Les premières missions arrivent très bientôt.</p>
            )}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
