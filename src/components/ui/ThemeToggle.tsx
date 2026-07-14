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
        width: 32,
        height: 32,
        flex: '0 0 32px',
        display: 'grid',
        placeItems: 'center',
        borderRadius: 10,
        border: `1px solid ${T.cb}`,
        background: T.row,
        color: T.text,
        cursor: 'pointer',
        fontSize: 16,
        lineHeight: 1,
      }}
    >
      <span aria-hidden="true">{mode === 'dark' ? '☀️' : '🌙'}</span>
    </button>
  );
}
