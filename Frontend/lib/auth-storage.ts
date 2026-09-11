// Simple token storage. The backend returns access_token + refresh_token as
// JSON, so we keep them in localStorage for the starter.
//
// SECURITY NOTE (read later, not blocking now): localStorage is readable by any
// JavaScript on the page, so it is vulnerable to XSS. For production, the common
// hardening is to have the backend set the refresh token as an httpOnly cookie
// (a backend change) and keep only the short-lived access token in memory. Fine
// for local development and learning as-is.

const ACCESS_KEY = "zoiko.access_token";
const REFRESH_KEY = "zoiko.refresh_token";
const PLATFORM_KEY = "zoiko.platform_token";

const hasWindow = () => typeof window !== "undefined";

export function getAccessToken(): string | null {
  return hasWindow() ? window.localStorage.getItem(ACCESS_KEY) : null;
}
export function getRefreshToken(): string | null {
  return hasWindow() ? window.localStorage.getItem(REFRESH_KEY) : null;
}
// Platform (staff) session token — present for Zoiko staff who log in to the
// support console without a tenant membership. These requests carry no tenant,
// so they must NOT go through the refresh flow (no refresh counterpart exists).
export function getPlatformToken(): string | null {
  return hasWindow() ? window.localStorage.getItem(PLATFORM_KEY) : null;
}
export function setTokens(accessToken: string, refreshToken?: string): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) window.localStorage.setItem(REFRESH_KEY, refreshToken);
}
export function setPlatformToken(platformToken: string): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(PLATFORM_KEY, platformToken);
}

export function clearPlatformToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("zoiko.platform_token");
  }
}

export function clearTokens(): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.localStorage.removeItem(PLATFORM_KEY);
}
export function isLoggedIn(): boolean {
  return !!(getAccessToken() || getPlatformToken());
}

/**
 * Why the last session ended, when it ended for a reason worth explaining.
 *
 * Signing into a second workspace ends every session for the first one, so a
 * tab left open there stops working. Without a note the user just finds
 * themselves back at the login form, which reads as a fault rather than as
 * the rule it is. Written on the way out and shown once on the login screen.
 */
export const SIGN_OUT_NOTICE_KEY = "zoiko.sign_out_notice";

export function setSignOutNotice(message: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SIGN_OUT_NOTICE_KEY, message);
  } catch {
    // Private-mode storage failures must never break signing out.
  }
}

/**
 * Reads the notice without consuming it.
 *
 * Deliberately not a read-and-clear. A consuming read is only safe if the
 * component reads it exactly once, and the login form cannot promise that:
 * two guards can each redirect to /login, so it mounts twice, the first mount
 * consumes the message and the second renders nothing. That showed up as the
 * explanation appearing only sometimes — the same trap as the
 * create-workspace screen, reached by a remount rather than by StrictMode.
 *
 * Cleared by clearSignOutNotice once the reader is done with it.
 */
export function peekSignOutNotice(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(SIGN_OUT_NOTICE_KEY);
  } catch {
    return null;
  }
}

/** Drops the notice, once the person has seen it and moved on. */
export function clearSignOutNotice(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SIGN_OUT_NOTICE_KEY);
  } catch {
    // Private-mode storage failures must not break the form.
  }
}
