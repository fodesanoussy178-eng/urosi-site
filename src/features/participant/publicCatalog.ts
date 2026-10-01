import { useEffect, useState } from 'react';
import { fetchPublicCatalog, type PublicCatalog } from '@/features/missions/solidarityMissions';

// Cache de page : la fiche mission ouverte depuis le catalogue ne recharge rien.
let cached: Promise<PublicCatalog> | null = null;

export function loadPublicCatalog(): Promise<PublicCatalog> {
  if (!cached) {
    cached = fetchPublicCatalog().catch((error) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

export function resetPublicCatalogForTests(): void {
  cached = null;
}

export function usePublicCatalog(): { catalog: PublicCatalog | null; loading: boolean } {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    loadPublicCatalog()
      .then((c) => active && setCatalog(c))
      .catch(() => active && setCatalog({ missions: [], demo: false }))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);
  return { catalog, loading };
}

export const MEL_CITIES = ['Lille', 'Roubaix', 'Tourcoing', 'Villeneuve-d’Ascq', 'Marcq-en-Barœul', 'Lambersart', 'Wattrelos', 'La Madeleine', 'Lomme', 'Croix', 'Mons-en-Barœul', 'Hem', 'Loos', 'Ronchin', 'Wasquehal', 'Armentières', 'Seclin'];
