"use client";

import { useEffect } from "react";
import Image from "next/image";
import { RefreshCw, RotateCcw } from "lucide-react";

/**
 * What a route's error boundary (app/**\/error.tsx) shows when a screen
 * throws while rendering: the brand mark, a plain explanation, and two ways
 * on — try the screen again, or reload the page. The error's message is not
 * shown; it can carry internals that mean nothing to the person reading it.
 */
export function RouteError({
  error,
  reset,
  fullScreen = false,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** No shell around it (the app-wide boundary). */
  fullScreen?: boolean;
}) {
  useEffect(() => {
    // Still reaches the console (and anything watching it) for diagnosis.
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      data-testid="route-error"
      className={`zoi-fade flex w-full flex-col items-center justify-center gap-4 px-4 text-center ${
        fullScreen ? "min-h-screen bg-[var(--ground)] text-[var(--ink)]" : "min-h-[22rem] flex-1 py-12"
      }`}
    >
      <Image src="/zoiko-icon.png" width={48} height={48} alt="" className="rounded-[11px] shadow-[var(--sh1)]" />
      <div>
        <h2 className="text-base font-semibold text-[var(--ink)]">This page didn&rsquo;t load</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--ink3)]">
          Something went wrong while showing it. Your data is safe. Try again, or reload the page.
        </p>
        {error.digest && <p className="font-mono-num mt-2 text-[11px] text-[var(--ink3)]">Reference: {error.digest}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={reset} className="zoiko-btn pri">
          <RotateCcw className="h-3.5 w-3.5" />
          Try again
        </button>
        <button type="button" onClick={() => window.location.reload()} className="zoiko-btn">
          <RefreshCw className="h-3.5 w-3.5" />
          Reload
        </button>
      </div>
    </div>
  );
}

export default RouteError;
