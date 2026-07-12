export const FOUNDER_CODE = 'AGORA59';

export function isFounderCode(value: string | null | undefined): boolean {
  return (value ?? '').trim().toUpperCase() === FOUNDER_CODE;
}
