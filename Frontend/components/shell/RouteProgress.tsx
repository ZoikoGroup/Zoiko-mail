"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type Phase = "idle" | "running" | "finishing";

// The bar creeps toward ~85% while the route loads and snaps to 100% + fades
// the moment the new page renders. A safety timer keeps it from ever hanging.
const MAX_MS = 8000;
const FINISH_MS = 350;

/**
 * Top loading bar for client-side navigations. Starts on internal link clicks
 * and back/forward, completes when usePathname() reports the new page.
 * Renders nothing until a navigation starts, so SSR/hydration are untouched.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const safetyTimer = useRef<number | undefined>(undefined);
  const finishTimer = useRef<number | undefined>(undefined);

  const start = useCallback(() => {
    if (phaseRef.current !== "idle") return;
    setPhase("running");
    window.clearTimeout(safetyTimer.current);
    safetyTimer.current = window.setTimeout(() => setPhase("finishing"), MAX_MS);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }
      const raw = anchor.getAttribute("href");
      if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) {
        return;
      }
      const url = new URL(anchor.href, location.href);
      // External links open normally; same-page links have nothing to load.
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      start();
    };
    const onPopState = () => start();
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, [start]);

  // The initial mount is not a navigation; every pathname change after it
  // means the new page rendered — finish the bar.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setPhase((p) => (p === "running" ? "finishing" : p));
  }, [pathname]);

  useEffect(() => {
    if (phase !== "finishing") return;
    finishTimer.current = window.setTimeout(() => setPhase("idle"), FINISH_MS);
    return () => window.clearTimeout(finishTimer.current);
  }, [phase]);

  useEffect(
    () => () => {
      window.clearTimeout(safetyTimer.current);
      window.clearTimeout(finishTimer.current);
    },
    []
  );

  if (phase === "idle") return null;
  return <div className="route-progress" data-phase={phase} aria-hidden="true" />;
}

export default RouteProgress;
