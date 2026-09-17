import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { resolveColors, type Palette } from '../lib/theme';
import type { KeyValueStore } from '../lib/storage';

export type ThemeMode = 'light' | 'dark' | 'system';
const MODE_KEY = 'mico360.themeMode';

interface ThemeContextValue {
  colors: Palette;
  mode: ThemeMode;
  scheme: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Provides the active palette (A0.2 light/dark). Follows the OS by default; a persisted override wins. */
export function ThemeProvider({ store, children }: { store: KeyValueStore; children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    let active = true;
    store
      .getItem(MODE_KEY)
      .then((v) => {
        if (active && (v === 'light' || v === 'dark' || v === 'system')) setModeState(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [store]);

  const scheme: 'light' | 'dark' = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const colors = useMemo(() => resolveColors(scheme), [scheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors,
      mode,
      scheme,
      setMode: (next) => {
        setModeState(next);
        void store.setItem(MODE_KEY, next).catch(() => {});
      },
    }),
    [colors, mode, scheme, store],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}

export function useColors(): Palette {
  return useTheme().colors;
}
