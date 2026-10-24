"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * The Member inbox's pane sizes: how wide the folder column and the message
 * list are, the reading pane taking the rest.
 *
 * "Standard" is the design's default layout. "Custom" is whatever the person
 * set — by dragging a divider or with the sliders in the Layout menu — and is
 * remembered in this browser, as mail clients remember their panes. Switching
 * back to Standard keeps the custom sizes, so Custom brings them back.
 *
 * Only desktop widths (lg+) use these; on a phone one pane shows at a time.
 */

export type PaneMode = "standard" | "custom";

export interface PaneLimits {
  min: number;
  max: number;
  /** The Standard size. The list's is responsive (wider on xl), so this is the lg value. */
  standard: number;
}

export const FOLDER_PANE: PaneLimits = { min: 200, max: 360, standard: 240 };
export const LIST_PANE: PaneLimits = { min: 300, max: 760, standard: 360 };
/** The reading pane is never squeezed below this; the list gives way first. */
export const READING_PANE_MIN = 420;

const STORAGE_KEY = "zoiko.mail.paneLayout.v1";

interface StoredLayout {
  mode: PaneMode;
  folderWidth: number;
  listWidth: number;
}

const clamp = (value: number, limits: PaneLimits) =>
  Math.round(Math.min(limits.max, Math.max(limits.min, value)));

function read(): StoredLayout | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLayout>;
    if (parsed.mode !== "standard" && parsed.mode !== "custom") return null;
    return {
      mode: parsed.mode,
      folderWidth: clamp(Number(parsed.folderWidth) || FOLDER_PANE.standard, FOLDER_PANE),
      listWidth: clamp(Number(parsed.listWidth) || LIST_PANE.standard, LIST_PANE),
    };
  } catch {
    // Private windows and blocked storage: the standard layout still works.
    return null;
  }
}

function write(layout: StoredLayout) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Not remembered, but the layout still applies for this visit.
  }
}

export interface PaneLayout {
  mode: PaneMode;
  /** The custom sizes, kept while in Standard so Custom restores them. */
  folderWidth: number;
  listWidth: number;
  /** The width to draw at, or null for the Standard (class-based) width. */
  effectiveFolderWidth: number | null;
  effectiveListWidth: number | null;
  setMode: (mode: PaneMode) => void;
  /** Sets a custom size, switching to Custom. */
  setFolderWidth: (width: number) => void;
  setListWidth: (width: number) => void;
  /** Back to Standard. */
  reset: () => void;
}

const PaneLayoutContext = createContext<PaneLayout | null>(null);

export function PaneLayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<StoredLayout>({
    mode: "standard",
    folderWidth: FOLDER_PANE.standard,
    listWidth: LIST_PANE.standard,
  });
  const [loaded, setLoaded] = useState(false);

  // Read after mount: the server render has no storage, and reading during
  // render would make the first client render disagree with it.
  useEffect(() => {
    const stored = read();
    if (stored) setLayout(stored);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) write(layout);
  }, [layout, loaded]);

  const setMode = useCallback((mode: PaneMode) => setLayout((current) => ({ ...current, mode })), []);
  const setFolderWidth = useCallback(
    (width: number) => setLayout((current) => ({ ...current, mode: "custom", folderWidth: clamp(width, FOLDER_PANE) })),
    []
  );
  const setListWidth = useCallback(
    (width: number) => setLayout((current) => ({ ...current, mode: "custom", listWidth: clamp(width, LIST_PANE) })),
    []
  );
  const reset = useCallback(() => setLayout((current) => ({ ...current, mode: "standard" })), []);

  const value = useMemo<PaneLayout>(
    () => ({
      ...layout,
      effectiveFolderWidth: layout.mode === "custom" ? layout.folderWidth : null,
      effectiveListWidth: layout.mode === "custom" ? layout.listWidth : null,
      setMode,
      setFolderWidth,
      setListWidth,
      reset,
    }),
    [layout, setMode, setFolderWidth, setListWidth, reset]
  );

  return <PaneLayoutContext.Provider value={value}>{children}</PaneLayoutContext.Provider>;
}

/** The pane layout, or null outside the Member inbox (Admin and Owner keep fixed panes). */
export function usePaneLayout(): PaneLayout | null {
  return useContext(PaneLayoutContext);
}
