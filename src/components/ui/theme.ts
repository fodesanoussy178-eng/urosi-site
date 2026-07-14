// Design tokens du prototype UROSI v0.5 (claude.ai) : theme sombre profond,
// DM Sans, degrade bleu/cyan. Reproduits tels quels pour un rendu identique.
export const T = {
  bg: 'var(--urosi-bg)',
  card: 'var(--urosi-card)',
  cb: 'var(--urosi-border)',
  row: 'var(--urosi-row)',
  text: 'var(--urosi-text)',
  sub: 'var(--urosi-sub)',
  mu: 'var(--urosi-muted)',
  grad: 'var(--urosi-gradient)',
  cyan: 'var(--urosi-cyan)',
  green: 'var(--urosi-green)',
  greenBg: 'var(--urosi-green-bg)',
  greenBorder: 'var(--urosi-green-border)',
  red: 'var(--urosi-red)',
  redBg: 'var(--urosi-red-bg)',
  redBorder: 'var(--urosi-red-border)',
  amber: 'var(--urosi-amber)',
  amberBg: 'var(--urosi-amber-bg)',
  amberBorder: 'var(--urosi-amber-border)',
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
