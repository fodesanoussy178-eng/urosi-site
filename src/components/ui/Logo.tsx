// Logo UROSI du prototype v0.5, reproduit a l'identique.
export function Logo({ sz = 52 }: { sz?: number }) {
  const a = '#67e8f9';
  const b = '#22d3ee';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={sz} height={sz} viewBox="0 0 100 100" fill="none">
        <defs>
          <linearGradient id="ug" x1="20" y1="5" x2="80" y2="95" gradientUnits="userSpaceOnUse">
            <stop stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
        </defs>
        <path d="M47 95Q46 74 44 61Q42 49 50 44Q58 49 56 61Q54 74 53 95Z" fill="url(#ug)" />
        <path d="M50 44Q34 37 20 27Q29 25 38 31Q44 36 50 40" fill="url(#ug)" opacity=".85" />
        <path d="M50 44Q66 37 80 27Q71 25 62 31Q56 36 50 40" fill="url(#ug)" opacity=".85" />
        <path d="M42 29Q37 16 39 7Q45 11 45 20Q45 26 44 31" fill="url(#ug)" opacity=".8" />
        <path d="M58 29Q63 16 61 7Q55 11 55 20Q55 26 56 31" fill="url(#ug)" opacity=".8" />
        <ellipse cx="19" cy="25" rx="7" ry="4.5" fill={a} opacity=".9" transform="rotate(-20 19 25)" />
        <ellipse cx="81" cy="25" rx="7" ry="4.5" fill={a} opacity=".9" transform="rotate(20 81 25)" />
        <ellipse cx="50" cy="7" rx="6.5" ry="4" fill={a} opacity=".9" />
        <ellipse cx="29" cy="17" rx="6.5" ry="4" fill={b} opacity=".85" transform="rotate(-35 29 17)" />
        <ellipse cx="71" cy="17" rx="6.5" ry="4" fill={b} opacity=".85" transform="rotate(35 71 17)" />
      </svg>
      <span style={{ fontSize: Math.round(sz * 0.22), fontWeight: 900, color: '#f1f5f9', letterSpacing: -0.3 }}>UROSI</span>
    </div>
  );
}
