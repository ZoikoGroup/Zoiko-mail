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

const hasWindow = () => typeof window !== "undefined";

export function getAccessToken(): string | null {
  return hasWindow() ? window.localStorage.getItem(ACCESS_KEY) : null;
}
export function getRefreshToken(): string | null {
  return hasWindow() ? window.localStorage.getItem(REFRESH_KEY) : null;
}
export function setTokens(accessToken: string, refreshToken?: string): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) window.localStorage.setItem(REFRESH_KEY, refreshToken);
}
export function clearTokens(): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}
export function isLoggedIn(): boolean {
  return !!getAccessToken();
}