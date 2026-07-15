import { T } from './theme';

export function Stars({ n, size = 12, animateOnce = false }: { n: number; size?: number; animateOnce?: boolean }) {
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span
      className={animateOnce ? 'urosi-stars urosi-stars--animate' : 'urosi-stars'}
      style={{ fontSize: size, letterSpacing: 1 }}
      role="img"
      aria-label={`${n.toFixed(1).replace('.', ',')} étoiles sur 5`}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          className="urosi-star"
          aria-hidden="true"
          style={{ color: index < full ? '#f59e0b' : T.cb, animationDelay: animateOnce ? `${index * 80}ms` : undefined }}
        >
          ★
        </span>
      ))}
    </span>
  );
}
