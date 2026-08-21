/**
 * Admin workspace primitive. Composes the tokens and .zoiko-* classes that
 * already exist in app/globals.css rather than introducing a second styling
 * vocabulary.
 */

import type { ReactNode } from "react";

/* ── card ──────────────────────────────────────────────────────────────── */

export function Card({
  title,
  badge,
  action,
  padded = false,
  children,
}: {
  title?: string;
  badge?: ReactNode;
  action?: ReactNode;
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="zoiko-card mb-4">
      {(title || badge || action) && (
        <header className="flex flex-wrap items-center gap-2.5 border-b border-[var(--border)] px-4 py-3">
          {title && <h2 className="text-[13.5px] font-semibold text-[var(--ink)]">{title}</h2>}
          {badge}
          {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={padded ? "px-4 py-4" : ""}>{children}</div>
    </section>
  );
}

/* ── row (label / detail / right-hand meta) ────────────────────────────── */

export function Row({
  title,
  detail,
  right,
}: {
  title: ReactNode;
  detail?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12.6px] font-semibold text-[var(--ink)]">{title}</div>
        {detail && <div className="text-[11px] text-[var(--ink3)]">{detail}</div>}
      </div>
      {right && <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}
