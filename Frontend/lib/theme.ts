/**
 * Light, dark, or whatever the device prefers.
 *
 * Mirrors the no-flash script in app/layout.tsx: a saved "light" or "dark"
 * wins, and no saved value means "follow the system". So choosing System
 * removes the key rather than storing a third value the script does not know.
 */

export type ThemePref = "light" | "dark" | "system";

export function readThemePref(): ThemePref {
  if (typeof window === "undefined") return "system";
  try {
    const t = localStorage.getItem("theme");
    return t === "dark" || t === "light" ? t : "system";
  } catch {
    return "system";
  }
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyThemePref(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  try {
    if (pref === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", pref);
  } catch {
    /* Not remembered, but applied for this visit. */
  }
}
