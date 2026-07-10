import { T } from './theme';

export function Stars({ n, size = 12 }: { n: number; size?: number }) {
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span style={{ fontSize: size, color: '#f59e0b', letterSpacing: 1 }}>
      {'★'.repeat(full)}
      <span style={{ color: T.cb }}>{'★'.repeat(5 - full)}</span>
    </span>
  );
}
