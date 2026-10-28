"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * The member's mailbox preferences (Settings → Mailbox Preferences):
 * which view Mail opens on, where the reading pane sits, list density and
 * when an opened message counts as read.
 *
 * Remembered in this browser, as the pane sizes are (lib/pane-layout.tsx),
 * until preferences are stored with the account. Anything unreadable falls
 * back to its default, so a stale or hand-edited value can never break Mail.
 */

export type InboxView = "all" | "unread" | "starred";
export type ReadingPanePosition = "right" | "bottom" | "off";
export type MessageDensity = "comfortable" | "compact";
/** Seconds after opening before a message is marked read; null never marks it. */
export type MarkReadDelay = 0 | 2 | 5 | null;

export interface MailPreferences {
  defaultView: InboxView;
  readingPane: ReadingPanePosition;
  showPreview: boolean;
  density: MessageDensity;
  markReadDelay: MarkReadDelay;
}

export const DEFAULT_MAIL_PREFERENCES: MailPreferences = {
  defaultView: "all",
  readingPane: "right",
  showPreview: true,
  density: "comfortable",
  markReadDelay: 0,
};

const STORAGE_KEY = "zoiko.mail.preferences.v1";

const VIEWS: InboxView[] = ["all", "unread", "starred"];
const PANES: ReadingPanePosition[] = ["right", "bottom", "off"];
const DENSITIES: MessageDensity[] = ["comfortable", "compact"];
const DELAYS: MarkReadDelay[] = [0, 2, 5, null];

const pick = <T,>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

function read(): MailPreferences | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MailPreferences>;
    const d = DEFAULT_MAIL_PREFERENCES;
    return {
      defaultView: pick(parsed.defaultView, VIEWS, d.defaultView),
      readingPane: pick(parsed.readingPane, PANES, d.readingPane),
      showPreview: typeof parsed.showPreview === "boolean" ? parsed.showPreview : d.showPreview,
      density: pick(parsed.density, DENSITIES, d.density),
      markReadDelay: pick(parsed.markReadDelay, DELAYS, d.markReadDelay),
    };
  } catch {
    // Private windows and blocked storage: the defaults still work.
    return null;
  }
}

function write(prefs: MailPreferences) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered, but the preferences still apply for this visit.
  }
}

export interface MailPreferencesValue {
  prefs: MailPreferences;
  /** False until browser storage has been read; the defaults show meanwhile. */
  loaded: boolean;
  save: (changes: Partial<MailPreferences>) => void;
  reset: () => void;
}

const MailPreferencesContext = createContext<MailPreferencesValue | null>(null);

/**
 * Holds the preferences for everything inside it. WebmailShell provides one;
 * a Settings page provides its own above the shell, because the page edits
 * them from outside it. Nested inside another, this one steps aside, so
 * there is only ever one copy to save to.
 */
export function MailPreferencesProvider({ children }: { children: ReactNode }) {
  const parent = useContext(MailPreferencesContext);
  const [prefs, setPrefs] = useState<MailPreferences>(DEFAULT_MAIL_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  // Read after mount: the server render has no storage, and reading during
  // render would make the first client render disagree with it.
  useEffect(() => {
    if (parent) return;
    const stored = read();
    if (stored) setPrefs(stored);
    setLoaded(true);
  }, [parent]);

  useEffect(() => {
    if (loaded && !parent) write(prefs);
  }, [prefs, loaded, parent]);

  const save = useCallback((changes: Partial<MailPreferences>) => setPrefs((current) => ({ ...current, ...changes })), []);
  const reset = useCallback(() => setPrefs(DEFAULT_MAIL_PREFERENCES), []);

  const value = useMemo<MailPreferencesValue>(() => ({ prefs, loaded, save, reset }), [prefs, loaded, save, reset]);

  if (parent) return <>{children}</>;
  return <MailPreferencesContext.Provider value={value}>{children}</MailPreferencesContext.Provider>;
}

const OUTSIDE: MailPreferencesValue = {
  prefs: DEFAULT_MAIL_PREFERENCES,
  loaded: true,
  save: () => undefined,
  reset: () => undefined,
};

/**
 * The member's preferences. Outside the Member webmail (the Admin and Owner
 * inboxes render the same MailClient) the defaults apply and saving does nothing.
 */
export function useMailPreferences(): MailPreferencesValue {
  return useContext(MailPreferencesContext) ?? OUTSIDE;
}
