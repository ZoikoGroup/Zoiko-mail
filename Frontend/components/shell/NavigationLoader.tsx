"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useIsFetching } from "@tanstack/react-query";
import { BrandLoader } from "@/components/ui/BrandLoader";

/** How long the loader keeps a navigation covered at most, so a stuck one can never lock the screen. */
const MAX_MS = 15_000;
/** The new page must be quiet this long before the loader leaves, so it does not drop between two requests. */
const SETTLE_MS = 80;
/** Once seen, it stays at least this long, so it never flashes. */
const MIN_VISIBLE_MS = 120;
const FADE_OUT_MS = 120;

/**
 * Whether the page under the loading screen still shows a loader of its own:
 * a BrandLoader (route fallback, shell gate, panel) or a skeleton. Those mean
 * its content is not ready yet, whatever the query count says.
 */
function pageIsLoading(): boolean {
  const own = (el: Element) => el.closest(".nav-loader") === null;
  return (
    Array.from(document.querySelectorAll('[data-testid="brand-loader"]')).some(own) ||
    Array.from(document.querySelectorAll(".zoi-skeleton")).some(own)
  );
}

/** The pathname an in-app navigation to `href` leads to, or null for one that stays on this page or leaves the app. */
function destination(href: string): string | null {
  try {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || url.pathname === location.pathname) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

interface Navigation {
  /** The page being left; null for the first load of the app. */
  from: string | null;
  /** Where it is going, for the palette (the mail workspace has its own). */
  to: string;
}

type RouterMethod = (href: string, options?: unknown) => void;
const WRAPPED = Symbol("navigation-loader");

/**
 * The branded loading screen, and the platform's only page-level loading
 * indicator: there is no top progress bar.
 *
 * The App Router keeps the current page on screen until the next one is ready
 * (its code and its server payload), and the next page then loads its data.
 * Without this, a click looked like nothing happened (the old page sat there,
 * fully interactive, for as long as that took) and the new page then appeared
 * half-loaded. This covers the screen from the moment a navigation starts until
 * the new page has rendered and is ready: no query left loading for the first
 * time, and no loader or skeleton of the page's own still on screen. So the
 * person goes from the old page, to the loader, to the finished page, with no
 * second loader in between.
 *
 * - It starts on every in-app navigation to another page: links, router.push()
 *   and router.replace() from code (redirects, notification clicks, sign-in
 *   and sign-out), and back/forward. Query-only changes (in-page tabs such as
 *   ?view=) and background refreshes never start it.
 * - On the first load of the app it takes over from the page's own full-screen
 *   loader (BrandLoader continues the same animation, so nothing blinks) and
 *   stays until the page's content is in, instead of handing over to the
 *   smaller loaders inside the page.
 * - BrandLoader fades in after 400ms, so a quick navigation never shows it;
 *   once shown it stays at least 120ms and fades out, so it never flashes.
 * - After 10s BrandLoader offers Reload; at 15s it steps aside regardless.
 */
export function NavigationLoader() {
  const pathname = usePathname();
  const router = useRouter();
  const firstLoads = useIsFetching({ predicate: (query) => query.state.data === undefined });
  const [nav, setNav] = useState<Navigation | null>(null);
  const [leaving, setLeaving] = useState(false);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const firstLoadsRef = useRef(firstLoads);
  firstLoadsRef.current = firstLoads;

  // Start: any navigation to another page, and the first load of the app if
  // the page is still loading when it mounts.
  useEffect(() => {
    const begin = (to: string, from: string | null = pathnameRef.current) => {
      setLeaving(false);
      // A navigation on top of one still in flight (a redirect, a second
      // click) keeps the loader up and waits for the newer destination.
      setNav((current) => {
        if (!current) return { from, to };
        return current.to === to ? current : { ...current, from, to };
      });
    };

    if (pageIsLoading() || firstLoadsRef.current > 0) begin(pathnameRef.current, null);

    // The App Router has no navigation events, but every in-app navigation
    // (<Link> included) goes through the one router object it shares with all
    // components, so wrapping its push and replace sees them all.
    const target = router as unknown as Record<"push" | "replace", RouterMethod & { [WRAPPED]?: RouterMethod }>;
    const originals = { push: target.push, replace: target.replace };
    for (const method of ["push", "replace"] as const) {
      const original = originals[method];
      if (original[WRAPPED]) continue;
      const wrapped: RouterMethod & { [WRAPPED]?: RouterMethod } = (href, options) => {
        const to = destination(href);
        // <Link> calls push inside a transition, and a state update made in
        // one waits for that transition: the loader would only appear once
        // the new page was ready. A microtask runs after it, at normal priority.
        if (to) queueMicrotask(() => begin(to));
        original(href, options);
      };
      wrapped[WRAPPED] = original;
      target[method] = wrapped;
    }

    // By popstate the address bar already shows the destination, while the
    // rendered page (pathnameRef) is still the one being left.
    const onPopState = () => {
      if (location.pathname !== pathnameRef.current) begin(location.pathname);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      for (const method of ["push", "replace"] as const) target[method] = target[method][WRAPPED] ?? target[method];
    };
  }, [router]);

  // Finish: the new page is on screen, nothing is loading for the first time,
  // and the page shows no loader or skeleton of its own, all for SETTLE_MS.
  // The page check matters: a route with a loading.tsx (admin, owner) changes
  // the address as soon as that fallback shows, before the page's own code
  // and queries exist, which would otherwise read as "done".
  // The minimum time on screen counts from when the loader was really seen
  // (past its fade-in delay, and not waiting under a page's own loader), not
  // from the start: on a busy main thread the two can be far apart.
  const root = useRef<HTMLDivElement>(null);
  const arrived = nav !== null && pathname !== nav.from;
  useEffect(() => {
    if (!nav) return;
    let seenAt: number | null = null;
    let quietSince: number | null = null;
    const check = window.setInterval(() => {
      const now = performance.now();
      const el = root.current;
      const shown = el?.querySelector('[data-testid="brand-loader"]');
      if (seenAt === null && el && shown && !el.hasAttribute("data-deferred") && Number(getComputedStyle(shown).opacity) > 0) {
        seenAt = now;
      }
      if (!arrived) return;
      // Only the first load of the app waits for the page's data. Moving
      // between pages leaves as soon as the new page is on screen: the page
      // shows its own panel loader or skeleton for its data, and a full-screen
      // logo for that would appear after nearly every click.
      if (nav.from === null && (firstLoadsRef.current > 0 || pageIsLoading())) {
        quietSince = null;
        return;
      }
      quietSince ??= now;
      const minimum = seenAt === null ? 0 : MIN_VISIBLE_MS - (now - seenAt);
      if (now - quietSince < Math.max(SETTLE_MS, minimum)) return;
      window.clearInterval(check);
      if (seenAt === null) setNav(null);
      else setLeaving(true);
    }, 25);
    return () => window.clearInterval(check);
  }, [nav, arrived]);

  // On the first load, the page's own full-screen loader (with its own
  // caption, e.g. "Opening the admin workspace") stays the one in view; this
  // one waits invisibly underneath and shows in the same frame that loader
  // goes, so the sequence carries on with no gap. A MutationObserver rather
  // than state: its callback runs before the browser paints the change.
  const firstLoad =nav !== null && nav.from === null;
  useEffect(() => {
    const el = root.current;
    if (!firstLoad || !el) return;
    const sync = () => {
      const pageScreen = Array.from(document.querySelectorAll('[data-testid="brand-loader"][data-variant="screen"]')).some(
        (loader) => !el.contains(loader)
      );
      el.toggleAttribute("data-deferred", pageScreen);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      el.removeAttribute("data-deferred");
    };
  }, [firstLoad]);

  // After the fade-out, remove it.
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => {
      setNav(null);
      setLeaving(false);
    }, FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  // Never longer than MAX_MS.
  useEffect(() => {
    if (!nav) return;
    const timer = window.setTimeout(() => setLeaving(true), MAX_MS);
    return () => window.clearTimeout(timer);
  }, [nav]);

  if (!nav) return null;
  return (
    <div
      ref={root}
      className="nav-loader"
      data-testid="navigation-loader"
      data-deferred={firstLoad ? "" : undefined}
      data-leaving={leaving ? "" : undefined}
    >
      <BrandLoader className={nav.to.startsWith("/mail") ? "zm-webmail" : ""} label="Loading Zoiko Mail" />
    </div>
  );
}

export default NavigationLoader;
