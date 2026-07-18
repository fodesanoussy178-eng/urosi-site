import { useEffect } from 'react';

type ScrollLockSnapshot = {
  scrollY: number;
  htmlOverflow: string;
  htmlOverscrollBehavior: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyRight: string;
  bodyWidth: string;
  bodyOverflow: string;
  bodyOverscrollBehavior: string;
};

let activeLocks = 0;
let snapshot: ScrollLockSnapshot | null = null;

function lockBodyScroll() {
  activeLocks += 1;
  if (activeLocks > 1 || typeof window === 'undefined') return;

  const html = document.documentElement;
  const body = document.body;
  snapshot = {
    scrollY: window.scrollY,
    htmlOverflow: html.style.overflow,
    htmlOverscrollBehavior: html.style.overscrollBehavior,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyRight: body.style.right,
    bodyWidth: body.style.width,
    bodyOverflow: body.style.overflow,
    bodyOverscrollBehavior: body.style.overscrollBehavior,
  };

  html.style.overflow = 'hidden';
  html.style.overscrollBehavior = 'none';
  body.style.position = 'fixed';
  body.style.top = `-${snapshot.scrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  body.style.overscrollBehavior = 'none';
}

function unlockBodyScroll() {
  activeLocks = Math.max(0, activeLocks - 1);
  if (activeLocks > 0 || !snapshot || typeof window === 'undefined') return;

  const html = document.documentElement;
  const body = document.body;
  const previous = snapshot;
  snapshot = null;

  html.style.overflow = previous.htmlOverflow;
  html.style.overscrollBehavior = previous.htmlOverscrollBehavior;
  body.style.position = previous.bodyPosition;
  body.style.top = previous.bodyTop;
  body.style.left = previous.bodyLeft;
  body.style.right = previous.bodyRight;
  body.style.width = previous.bodyWidth;
  body.style.overflow = previous.bodyOverflow;
  body.style.overscrollBehavior = previous.bodyOverscrollBehavior;
  window.scrollTo(0, previous.scrollY);
}

/** Empêche Safari iOS de faire défiler la page derrière une modale. */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return undefined;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [locked]);
}
