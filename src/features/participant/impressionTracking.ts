import { useEffect, useRef } from 'react';

// Tracking diffuseur API Engagement : une mission importée compte comme
// « vue » lorsqu'elle reste visible au moins 1,5 s. Un seul signal par
// mission et par session ; aucune donnée personnelle UROSI n'est transmise
// (requête sans cookies ni identifiant, vers l'URL officielle d'impression).
export const IMPRESSION_MIN_VISIBLE_MS = 1500;
const sent = new Set<string>();

export function sendImpression(url: string): void {
  if (sent.has(url)) return;
  sent.add(url);
  try {
    void fetch(url, { mode: 'no-cors', credentials: 'omit', keepalive: true, referrerPolicy: 'strict-origin-when-cross-origin' }).catch(() => undefined);
  } catch {
    // réseau indisponible : l'impression est simplement perdue
  }
}

export function resetImpressionsForTests(): void {
  sent.clear();
}

export function useImpressionTracking<T extends Element>(impressionUrl: string | null) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!impressionUrl || !node || sent.has(impressionUrl) || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5);
        clearTimeout(timer);
        if (visible) {
          timer = setTimeout(() => {
            sendImpression(impressionUrl);
            observer.disconnect();
          }, IMPRESSION_MIN_VISIBLE_MS);
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(node);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [impressionUrl]);

  return ref;
}
