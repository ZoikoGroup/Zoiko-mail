"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  /** Tighter spacing, for a pane or list rather than a whole page. */
  compact?: boolean;
}

export function ErrorState({
  message = "Something went wrong. Please try again.",
  onRetry,
  compact = false,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      data-testid="error-state"
      className={`zoi-fade flex flex-col items-center justify-center text-center ${compact ? "px-4 py-8" : "py-16"}`}
    >
      <span
        className={`inline-flex items-center justify-center rounded-xl bg-[var(--crit-soft)] text-[var(--crit)] ${
          compact ? "h-10 w-10" : "h-14 w-14"
        }`}
      >
        <AlertCircle className={compact ? "h-5 w-5" : "h-7 w-7"} />
      </span>
      <h3 className={`${compact ? "mt-3" : "mt-4"} text-sm font-semibold text-[var(--ink)]`}>
        Couldn&rsquo;t load this
      </h3>
      <p className="mt-1 max-w-sm text-sm text-[var(--ink3)]">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className={`zoiko-btn pri ${compact ? "mt-3" : "mt-4"}`}>
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}
