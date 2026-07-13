export const FOUNDER_EMAIL = 'fodesanoussy178@gmail.com';
export const FOUNDER_ACCESS_KEY = 'urosi_founder_access_user_v1';
export const DEMO_FOUNDER_ACCESS_KEY = 'urosi_demo_founder_access_v1';

const DEMO_FOUNDER_CODE = [65, 71, 79, 82, 65, 53, 57];

export function isFounderEmail(value: string | null | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === FOUNDER_EMAIL;
}

export function isDemoFounderCode(value: string | null | undefined): boolean {
  return (value ?? '').trim().toUpperCase() === String.fromCharCode(...DEMO_FOUNDER_CODE);
}

export function rememberDemoFounderAccess() {
  try {
    localStorage.setItem(DEMO_FOUNDER_ACCESS_KEY, '1');
  } catch {
    // ignore
  }
}

export function hasDemoFounderAccess(): boolean {
  try {
    return localStorage.getItem(DEMO_FOUNDER_ACCESS_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberFounderAccess(userId: string | null | undefined) {
  if (!userId) return;
  try {
    localStorage.setItem(FOUNDER_ACCESS_KEY, userId);
  } catch {
    // ignore
  }
}

export function hasRememberedFounderAccess(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(FOUNDER_ACCESS_KEY) === userId;
  } catch {
    return false;
  }
}
