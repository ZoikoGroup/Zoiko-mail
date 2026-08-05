'use client';

import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { applyTheme, cycleTheme, readStoredTheme, type Theme } from '@/lib/theme';

interface ThemeContextValue {
  theme: Theme;
  /** True once the stored preference has been read on the client. */
  ready: boolean;
  setTheme: (theme: Theme) => void;
  cycle: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Theme is context rather than store state because it is a presentation
 * concern with no bearing on authentication, and because the provider is
 * the natural place to reconcile the stored preference with the OS one
 * after hydration.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    applyTheme(stored);
    setReady(true);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
  }, []);

  const cycle = useCallback(() => {
    setThemeState((current) => {
      const next = cycleTheme(current);
      applyTheme(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ theme, ready, setTheme, cycle }), [theme, ready, setTheme, cycle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
