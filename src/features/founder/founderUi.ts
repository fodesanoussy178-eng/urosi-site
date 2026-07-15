import { T } from '@/components/ui/theme';

export const founderCard = {
  background: T.card,
  border: `1px solid ${T.cb}`,
  borderRadius: 14,
  padding: 16,
} as const;

export const founderButton = {
  background: T.row,
  border: `1px solid ${T.cb}`,
  borderRadius: 8,
  color: T.text,
  padding: '8px 11px',
  fontSize: 11,
  fontWeight: 800,
  cursor: 'pointer',
} as const;

export const founderInput = {
  width: '100%',
  boxSizing: 'border-box',
  background: T.row,
  border: `1px solid ${T.cb}`,
  borderRadius: 9,
  color: T.text,
  padding: '10px 12px',
  fontSize: 12,
} as const;

export const founderNotice = {
  ...founderCard,
  color: T.sub,
  fontSize: 12,
  lineHeight: 1.55,
} as const;

export function founderDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('fr-FR') : '—';
}

export function founderEuros(cents: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((Number(cents) || 0) / 100);
}
