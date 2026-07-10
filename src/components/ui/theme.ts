// Design tokens du prototype UROSI v0.5 (claude.ai) : theme sombre profond,
// DM Sans, degrade bleu/cyan. Reproduits tels quels pour un rendu identique.
export const T = {
  bg: '#0a0a14',
  card: '#111827',
  cb: '#1f2937',
  row: '#0f172a',
  text: '#f1f5f9',
  sub: '#9ca3af',
  mu: '#6b7280',
  grad: 'linear-gradient(135deg,#1d4ed8,#0891b2)',
  cyan: '#22d3ee',
  green: '#4ade80',
  greenBg: '#052e16',
  greenBorder: '#166534',
  red: '#f87171',
  redBg: '#1f0000',
  redBorder: '#7f1d1d',
  amber: '#fbbf24',
  amberBg: '#1c1400',
  amberBorder: '#78350f',
} as const;

export const FONT = "'DM Sans', system-ui, -apple-system, sans-serif";

export const inp = {
  width: '100%',
  background: T.row,
  border: `1px solid ${T.cb}`,
  borderRadius: 9,
  padding: '12px 13px',
  fontSize: 13,
  color: T.text,
  outline: 'none',
  boxSizing: 'border-box',
} as const;
