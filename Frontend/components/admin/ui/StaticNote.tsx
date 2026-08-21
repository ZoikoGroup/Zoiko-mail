/**
 * Admin workspace primitive. Composes the tokens and .zoiko-* classes that
 * already exist in app/globals.css rather than introducing a second styling
 * vocabulary.
 */

import type { ReactNode } from "react";

/* ── static-data marker ────────────────────────────────────────────────── */

/**
 * Flags a screen still reading fixtures, with a note on what the real data
 * depends on. Removed per screen as `lib/admin-hooks.ts` is wired up.
 */
export function StaticNote({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono-num mb-3.5 flex items-center gap-2 rounded-lg border border-dashed border-[var(--bstrong)] px-3 py-2 text-[11px] text-[var(--ink3)]">
      <span className="font-bold text-[var(--accent-ink)]">STATIC</span>
      <span>{children}</span>
    </div>
  );
}
