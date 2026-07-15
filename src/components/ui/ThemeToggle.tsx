import { useState } from 'react';
import { readThemeMode, saveThemeMode, type ThemeMode } from '@/lib/themeMode';
import { T } from './theme';

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode());
  const nextMode = mode === 'dark' ? 'light' : 'dark';
  const label = nextMode === 'light' ? 'Activer le mode clair' : 'Activer le mode sombre';

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        saveThemeMode(nextMode);
        setMode(nextMode);
      }}
      style={{
        width: 42,
        height: 42,
        flex: '0 0 42px',
        display: 'grid',
        placeItems: 'center',
        borderRadius: 13,
        border: `1px solid ${T.cb}`,
        background: T.row,
        color: T.text,
        cursor: 'pointer',
        fontSize: 18,
        lineHeight: 1,
      }}
    >
      <span aria-hidden="true">{mode === 'dark' ? '☀️' : '🌙'}</span>
    </button>
  );
}
