"use client";

import type { ReactNode } from "react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { ErrorState } from "@/components/ui/ErrorState";

/** The parts of a TanStack Query result this needs. */
export interface QueryLike<T> {
  data: T | undefined;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/**
 * One way to show a query's main content: the brand loader on its first load,
 * an error with Retry if that load fails, and the content once there is data.
 *
 * A background refetch never brings the loader back: once there is data it
 * stays on screen (and a failed refetch keeps the last good data), so lists
 * do not blink while they refresh. The slow-load notice's "Try again" refetches
 * just this query rather than reloading the page.
 *
 * A disabled query (enabled: false) has no data and never loads; render
 * something else for that case instead of wrapping it here.
 */
export function QueryState<T>({
  query,
  label,
  variant = "panel",
  errorMessage,
  isEmpty,
  empty = null,
  className,
  children,
}: {
  query: QueryLike<T>;
  /** What is loading, e.g. "Loading messages". */
  label: string;
  variant?: "panel" | "compact";
  /** Shown if the first load fails. Defaults to the error's own message. */
  errorMessage?: string;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  className?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined) {
    return <>{isEmpty?.(query.data) ? empty : children(query.data)}</>;
  }
  if (query.isError) {
    const message =
      errorMessage ?? (query.error instanceof Error && query.error.message ? query.error.message : undefined);
    return <ErrorState message={message} onRetry={() => void query.refetch()} compact={variant === "compact"} />;
  }
  return <BrandLoader variant={variant} label={label} className={className} onRetry={() => void query.refetch()} />;
}

export default QueryState;
