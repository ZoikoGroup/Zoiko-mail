"use client";

import { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";

interface Props {
  icon: LucideIcon;
  title: string;
  count: number;
  isLoading: boolean;
  isError: boolean;
  emptyMessage: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  children?: ReactNode;
}

// Reusable card for a digest section. Handles loading / error / empty
// consistently so each section on the page doesn't reinvent the states.
export default function DigestSection({
  icon: Icon,
  title,
  count,
  isLoading,
  isError,
  emptyMessage,
  viewAllHref,
  viewAllLabel,
  children,
}: Props) {
  return (
    <section className="zoiko-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-[var(--accent-ink)]" />
          <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
          {!isLoading && !isError && (
            <span className="zoiko-pill nu">{count}</span>
          )}
        </div>
        {viewAllHref && viewAllLabel && (
          <Link
            href={viewAllHref}
            className="text-xs font-medium text-[var(--accent-ink)] hover:underline"
          >
            {viewAllLabel} →
          </Link>
        )}
      </div>

      <div className="p-4">
        {/* The rows' shape is known, so placeholders of it rather than a
            loader per card: four logos at once would be noise. */}
        {isLoading && (
          <div role="status" aria-label={`Loading ${title.toLowerCase()}`} className="space-y-4 py-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            ))}
          </div>
        )}
        {isError && (
          <div className="text-sm text-[var(--crit)]">Couldn&rsquo;t load.</div>
        )}
        {!isLoading && !isError && count === 0 && (
          <div className="text-sm text-[var(--ink3)]">{emptyMessage}</div>
        )}
        {!isLoading && !isError && count > 0 && children}
      </div>
    </section>
  );
}