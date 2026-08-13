export type Theme = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'zoiko-theme';

/**
 * The manual toggle must beat the OS preference in both directions, so an
 * explicit choice writes data-theme on the root element and "system"
 * removes it entirely, handing control back to prefers-color-scheme.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable — the OS preference still applies.
  }
}

export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // Ignore.
  }
  return 'system';
}

export function cycleTheme(current: Theme): Theme {
  return current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
}

/** Inlined in the document head so a dark-mode user never sees a flash. */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
