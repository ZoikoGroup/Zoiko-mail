'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/lib/theme';

const META: Record<Theme, { Icon: typeof Sun; label: string }> = {
  system: { Icon: Monitor, label: 'Theme: follows your system' },
  light: { Icon: Sun, label: 'Theme: light' },
  dark: { Icon: Moon, label: 'Theme: dark' },
};

/**
 * Both themes carry equal contrast, so this is a preference rather than an
 * accessibility fallback. "System" removes the override entirely and hands
 * control back to prefers-color-scheme.
 */
export function ThemeToggle() {
  const { theme, ready, cycle } = useTheme();
  const { Icon, label } = META[theme];

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-field border border-border bg-surface/80 text-ink-3 backdrop-blur transition-colors hover:bg-s2 hover:text-ink"
    >
      {ready ? <Icon aria-hidden className="h-4 w-4" strokeWidth={1.7} /> : <span className="h-4 w-4" />}
    </button>
  );
}
