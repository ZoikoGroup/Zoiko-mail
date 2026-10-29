"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_EVENT, applyThemePref } from "@/lib/theme";

/**
 * Toggles the `.dark` class on <html> and persists the choice.
 * The no-flash initial value is set by the inline script in app/layout.tsx,
 * so on mount we just read whatever that script already applied.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  // Also follows changes made elsewhere (Settings → Appearance), so this
  // button never shows the opposite of what the page is doing.
  useEffect(() => {
    const sync = () => setDark(document.documentElement.classList.contains("dark"));
    sync();
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    applyThemePref(next ? "dark" : "light");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="zoiko-btn sm"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span className="hidden sm:inline">{dark ? "Light" : "Dark"}</span>
    </button>
  );
}

export default ThemeToggle;