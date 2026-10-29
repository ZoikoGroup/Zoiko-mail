"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";

/**
 * One loading sequence can pass through several loaders in a row: the support
 * page checks the session, then downloads a console, which checks again. Each
 * is a new element, and replaying the animations each time would make the
 * logo blink. So a loader that takes over from another (one still mounted, or
 * one gone less than CONTINUE_MS ago) carries on from where the sequence is:
 * its fade-in, halo and bar are offset by the time already elapsed, and the
 * slow-load notice is still at 10 seconds from the start of the whole
 * sequence. A takeover inside the first 140ms therefore stays invisible for
 * the rest of that delay, just as the first loader would have.
 */
const sequence = { active: 0, startedAt: 0, endedAt: -Infinity };
const CONTINUE_MS = 150;
const SLOW_MS = 10_000;

/** The continuation offsets, or null for a loader that starts a new sequence. */
function continuationStyle(): CSSProperties | null {
  if (typeof window === "undefined") return null;
  const now = performance.now();
  if (!(sequence.active > 0 || now - sequence.endedAt < CONTINUE_MS)) return null;
  const elapsed = Math.max(0, now - sequence.startedAt);
  return {
    ["--bl-elapsed" as string]: `-${Math.round(elapsed)}ms`,
    ["--bl-slow-delay" as string]: `${Math.round(Math.max(0, SLOW_MS - elapsed))}ms`,
  };
}

/**
 * The Zoiko Mail loading screen: the app icon with a soft breathing halo, the
 * wordmark, and a thin indeterminate bar.
 *
 * The CSS (globals.css, "Brand loader") decides when things show, with no
 * timers in script:
 *
 *   - It fades in after a short delay, so a load that finishes quickly never
 *     flashes a logo.
 *   - After ~10 seconds, "Taking longer than usual" and a Reload button
 *     appear, so a slow or stuck API never leaves a frozen screen with no way
 *     out.
 *
 * The only script is the sequence bookkeeping above: one read when the loader
 * first renders, and an effect that records when the sequence started and
 * ended. The first loader on a page always reads null, so the hydration render
 * is identical to the server's HTML, and the loader shows from the first byte
 * of HTML, before any script has loaded.
 *
 * Which loading indicator to use where (the platform's loading rules):
 *
 *   - BrandLoader `screen`: app start, session and workspace checks: no
 *     shell is on screen yet.
 *   - BrandLoader `panel` / `compact`: a page's or pane's main content on its
 *     first load (no data yet), inside the shell. Usually through
 *     <QueryState>, which also handles errors.
 *   - Skeletons (components/ui/Skeleton, DataTable `loading`): tables and
 *     card grids whose layout is known before the data arrives.
 *   - <Spinner>: buttons, single rows, "load more" and background refreshes.
 *     Never a full-screen or panel loader for those.
 *   - The top bar (RouteProgress): page navigation and API calls in flight.
 */
export type BrandLoaderVariant = "screen" | "panel" | "compact" | "inline";

const MARK: Record<Exclude<BrandLoaderVariant, "inline">, number> = { screen: 64, panel: 44, compact: 30 };

export function BrandLoader({
  variant: requested = "screen",
  label = "Loading Zoiko Mail",
  className = "",
  onRetry,
}: {
  /**
   * `screen` fills the viewport: app start, session and workspace checks.
   * `panel` fills a page's content area inside its shell. `compact` fits a
   * pane or list (the mail list, the reading pane, a preview). `inline` is
   * the older name for `panel`.
   */
  variant?: BrandLoaderVariant;
  /** The caption, also read to assistive technology. */
  label?: string;
  /** Extra classes on the wrapper, e.g. "zm-webmail" for the mail palette. */
  className?: string;
  /**
   * What the slow-load notice's button does. Given (e.g. a query's refetch),
   * it reads "Try again"; otherwise it reloads the page.
   */
  onRetry?: () => void;
}) {
  const variant = requested === "inline" ? "panel" : requested;
  const screen = variant === "screen";
  const mark = MARK[variant];

  // Only full-screen loaders hand over to one another within one load. A
  // pane's loader always starts fresh: two panes loading at different times
  // are two loads, and the second must not inherit the first's slow clock.
  // Computed once, when the loader first renders, and never again: the CSS
  // animations keep their start time, so changing these offsets on a later
  // re-render would move the slow notice and make the motion jump.
  const [continuation] = useState(() => (screen ? continuationStyle() : null));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!screen) return;
    if (sequence.active === 0 && performance.now() - sequence.endedAt >= CONTINUE_MS) {
      // A server-rendered loader has been on screen since before React ran.
      // Its fade-in animation's startTime says since when, on the same clock
      // as performance.now(), and stays valid after the animation finishes.
      const fade = root.current?.getAnimations?.()[0];
      sequence.startedAt = typeof fade?.startTime === "number" ? fade.startTime : performance.now();
    }
    sequence.active += 1;
    return () => {
      sequence.active -= 1;
      sequence.endedAt = performance.now();
    };
    // `screen` is fixed for a loader's life: callers switch variants by
    // rendering a different element, never by changing this prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={root}
      className={`brand-loader ${className}`}
      data-variant={variant}
      data-continued={continuation ? "" : undefined}
      style={continuation ?? undefined}
      data-testid="brand-loader"
      // No aria-busy: it would let screen readers hold back the slow notice.
      role="status"
      aria-live="polite"
    >
      <div className="brand-loader__body">
        <div className="brand-loader__mark" style={{ width: mark, height: mark }}>
          <span className="brand-loader__halo" aria-hidden="true" />
          <Image
            src="/zoiko-icon.png"
            width={mark}
            height={mark}
            alt=""
            priority
            className="brand-loader__icon"
          />
        </div>

        {screen && (
          <>
            <Image src="/zoiko-wordmark.png" width={277} height={36} alt="Zoiko Mail" priority className="brand-loader__wordmark dark:hidden" />
            <Image
              src="/zoiko-wordmark-dark.png"
              width={277}
              height={36}
              alt="Zoiko Mail"
              priority
              className="brand-loader__wordmark hidden dark:block"
            />
          </>
        )}

        <div className="brand-loader__track" aria-hidden="true">
          <span className="brand-loader__bar" />
        </div>

        <span className="brand-loader__label">{label}</span>

        <div className="brand-loader__slow" data-testid="brand-loader-slow">
          <span>Taking longer than usual.</span>
          <button type="button" onClick={onRetry ?? (() => window.location.reload())}>
            {onRetry ? "Try again" : "Reload"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BrandLoader;
