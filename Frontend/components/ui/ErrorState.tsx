"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  message = "Something went wrong. Please try again.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--crit-soft)] text-[var(--crit)]">
        <AlertCircle className="h-7 w-7" />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-[var(--ink)]">Error</h3>
      <p className="mt-1 max-w-sm text-sm text-[var(--ink3)]">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="zoiko-btn pri mt-4">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}
