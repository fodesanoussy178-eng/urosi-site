export const FOUNDER_EMAIL = 'fodesanoussy178@gmail.com';
export const FOUNDER_ACCESS_KEY = 'urosi_founder_access_user_v1';

export function isFounderEmail(value: string | null | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === FOUNDER_EMAIL;
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
