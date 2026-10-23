"use client";

import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";

/**
 * What a section of the Member workspace shows until it is built: a calm,
 * honest placeholder instead of half-working screens. Each section says what
 * it will be for, and the way back to mail is one click.
 */
export function ComingSoon({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <section
      aria-labelledby="coming-soon-title"
      className="flex h-full min-h-0 flex-1 items-center justify-center overflow-y-auto bg-[var(--ground)] p-6"
      data-testid="coming-soon"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--sh2)]">
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <Icon className="h-7 w-7" aria-hidden />
        </span>
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Coming Soon...</p>
        <h1 id="coming-soon-title" className="mt-2 text-2xl font-semibold text-[var(--ink)]">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ink2)]">{description}</p>
        <Link
          href="/mail"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:bg-[var(--s2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to Mail
        </Link>
      </div>
    </section>
  );
}
