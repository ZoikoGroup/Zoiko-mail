"use client";

import { useEffect } from "react";

import { getMe } from "./auth-api";
import { ACCESS_KEY, PLATFORM_KEY, getAccessToken, getPlatformToken, isLoggedIn } from "./auth-storage";
import { resolveWorkspaceHref } from "./workspace";

/**
 * Keeps every open tab on the session the browser actually holds.
 *
 * Tokens live in localStorage, which all tabs share, so signing in from one
 * tab replaces the session the others are using. A tab that does not notice
 * keeps rendering the console it loaded — with its cached name and role in the
 * header — while its requests go out on the new session. Signing in as a
 * member in one tab made an open Admin tab show "This action requires the
 * workspace.mailboxes.manage capability": the API was right to refuse, the
 * tab was simply no longer the session it showed.
 *
 * The workspace guard would catch it on its next /auth/me read, but its answer
 * to a mismatch is to clear the tokens — which signs the other tab out too.
 * So this moves the tab instead: to the new session's own workspace, or to
 * the sign-in page when the session ended. Nothing is cleared, and the rule
 * that each workspace needs its own sign-in is unchanged.
 *
 * Only tabs showing a workspace move; sign-in, MFA, invitation and other
 * account pages are left alone so a flow in progress is never interrupted.
 */

/** Pages that are part of signing in or managing an account, not a workspace. */
const ACCOUNT_PAGES = [
  "/login",
  "/register",
  "/verify-email",
  "/verify-mfa",
  "/select-workspace",
  "/create-workspace",
  "/accept-invitation",
  "/auth-status",
  "/forgot-password",
  "/reset-password",
  "/terms",
  "/privacy",
];

function onAccountPage(pathname: string): boolean {
  return pathname === "/" || ACCOUNT_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

/**
 * Signing in clears and then writes the tokens, which reaches other tabs as
 * two events; acting on the first would bounce through the sign-in page.
 */
const SETTLE_MS = 400;

export function useCrossTabSession(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const follow = async () => {
      if (onAccountPage(window.location.pathname)) return;
      if (!isLoggedIn()) {
        window.location.assign("/login");
        return;
      }
      if (getPlatformToken() && !getAccessToken()) {
        window.location.assign("/support");
        return;
      }
      try {
        const me = await getMe();
        const target = resolveWorkspaceHref(me.workspace);
        // Already on the right console (a token refresh in another tab):
        // nothing to do.
        if (window.location.pathname === target || window.location.pathname.startsWith(`${target}/`)) return;
        window.location.assign(target);
      } catch {
        window.location.assign("/login");
      }
    };

    const onStorage = (event: StorageEvent) => {
      // key is null when another tab cleared all of storage.
      if (event.key !== null && event.key !== ACCESS_KEY && event.key !== PLATFORM_KEY) return;
      if (event.key !== null && event.oldValue === event.newValue) return;
      clearTimeout(timer);
      timer = setTimeout(() => void follow(), SETTLE_MS);
    };

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearTimeout(timer);
    };
  }, []);
}
