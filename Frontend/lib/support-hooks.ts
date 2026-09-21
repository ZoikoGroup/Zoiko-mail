"use client";

import { useEffect, useRef } from "react";

/**
 * Re-run an existing loader on an interval.
 *
 * The two console shells are several thousand lines of bespoke state that
 * predate this file. Rewriting them to get polling would be a large change to
 * code with almost no browser coverage, and the benefit — a screen that keeps
 * up — does not need the rewrite. This gives them the refresh now; the query
 * layer above is what they move onto screen by screen.
 *
 * Skips hidden tabs for the same reason QUEUE does, and holds the callback in
 * a ref so a loader redefined each render does not restart the timer.
 */
export function useLiveRefresh(reload: () => void, everyMs = 30_000, enabled = true): void {
  const latest = useRef(reload);
  latest.current = reload;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      latest.current();
    };
    const id = window.setInterval(tick, everyMs);
    // A tab coming back to the front is the moment its contents are most
    // likely to be stale and most likely to be read.
    const onVisible = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs, enabled]);
}