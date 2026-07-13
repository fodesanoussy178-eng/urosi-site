export const FOUNDER_EMAIL = 'fodesanoussy178@gmail.com';

export function isFounderEmail(value: string | null | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === FOUNDER_EMAIL;
}
