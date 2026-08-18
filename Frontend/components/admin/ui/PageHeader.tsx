/**
 * Admin workspace primitive. Composes the tokens and .zoiko-* classes that
 * already exist in app/globals.css rather than introducing a second styling
 * vocabulary.
 */

import type { ReactNode } from "react";

/* ── page header ───────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="min-w-0">
        <h1 className="font-editorial text-[25px] font-normal leading-tight tracking-[-0.016em] text-[var(--ink)]">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-[var(--ink3)]">{subtitle}</p>}
      </div>
      {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
    </div>
  );
}
