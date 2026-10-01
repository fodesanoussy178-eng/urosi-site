import { useCallback, useEffect, useState } from 'react';
import { geocodeMelCity, type LatLng } from '@/lib/geo';

// Favoris : confort personnel, stockés sur l'appareil (phase 0, pas de table
// dédiée). Toute lecture/écriture est protégée : navigation privée, stockage
// bloqué… l'app fonctionne alors simplement sans mémoire des favoris.
export function useFavorites(ownerId: string | null) {
  const storageKey = `urosi_favorites_v1:${ownerId ?? 'anon'}`;
  const [keys, setKeys] = useState<Set<string>>(() => readFavorites(storageKey));

  useEffect(() => {
    setKeys(readFavorites(storageKey));
  }, [storageKey]);

  const toggle = useCallback(
    (key: string) => {
      setKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        try {
          localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          // stockage indisponible : favori conservé pour la session seulement
        }
        return next;
      });
    },
    [storageKey],
  );

  return { favorites: keys, toggleFavorite: toggle };
}

function readFavorites(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

// Position : celle du navigateur si la personne l'accepte (jamais stockée),
// sinon la ville du profil, sinon le centre de Lille pour « Lille et alentours ».
export function useApproxPosition(city: string | null | undefined): { position: LatLng | null; precise: boolean } {
  const [browser, setBrowser] = useState<LatLng | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setBrowser({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }, []);

  if (browser) return { position: browser, precise: true };
  const fromCity = city ? geocodeMelCity(city) : null;
  return { position: fromCity, precise: false };
}
