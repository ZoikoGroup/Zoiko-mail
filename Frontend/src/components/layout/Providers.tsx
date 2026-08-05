'use client';

import type { ReactNode } from 'react';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * Single composition point for client-side providers, so the root layout
 * stays a server component and new providers are added in one place.
 */
export function Providers({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
