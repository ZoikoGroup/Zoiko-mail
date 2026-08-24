"use client";

import { useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { useGeneralSettings, useUpdateGeneralSettings, useUpdateTenant } from "@/lib/owner-hooks";
import type { GeneralWorkspaceSettings } from "@/lib/owner-api";
import {
  Bell, Palette, Globe, Clock, Save, Sun, Moon, Monitor, CheckCircle2, AlertTriangle,
} from "lucide-react";

type ThemePref = GeneralWorkspaceSettings["theme"];

const DEFAULTS: Pick<GeneralWorkspaceSettings, "emailNotifications" | "digestFrequency" | "theme"> = {
  emailNotifications: true,
  digestFrequency: "daily",
  theme: "system",
};

/** Mirrors the no-flash script in app/layout.tsx: "system" = follow OS preference. */
function applyTheme(pref: ThemePref) {
  const dark =
    pref === "dark" ||
    (pref === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  try {
    if (pref === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", pref);
  } catch {
    /* ignore storage failures */
  }
}

function currentThemePref(): ThemePref {
  if (typeof window === "undefined") return "system";
  try {
    const t = localStorage.getItem("theme");
    return t === "dark" || t === "light" ? t : "system";
  } catch {
    return "system";
  }
}

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
];

export default function GeneralSettingsPage() {
  const { data: serverSettings, isLoading } = useGeneralSettings();
  const updateGeneral = useUpdateGeneralSettings();
  const updateTenant = useUpdateTenant();

  const [notifications, setNotifications] = useState(DEFAULTS);
  const [timezone, setTimezone] = useState("UTC");
  const [language, setLanguage] = useState("en");
  const [initialized, setInitialized] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local theme choice reflects what's currently applied (localStorage),
  // then gets reconciled with the server value once it loads.
  const [theme, setTheme] = useState<ThemePref>("system");
  useEffect(() => {
    setTheme(currentThemePref());
  }, []);

  useEffect(() => {
    if (serverSettings && !initialized) {
      setNotifications({
        emailNotifications: serverSettings.emailNotifications,
        digestFrequency: serverSettings.digestFrequency,
        theme: serverSettings.theme,
      });
      setTimezone(serverSettings.timezone || "UTC");
      setLanguage(serverSettings.language || "en");
      setInitialized(true);
      // Server value wins over any stale local preference on first load.
      setTheme(serverSettings.theme);
      applyTheme(serverSettings.theme);
    }
  }, [serverSettings, initialized]);

  const handleThemeSelect = (pref: ThemePref) => {
    setTheme(pref);
    applyTheme(pref);
  };

  const handleSave = () => {
    setError(null);
    updateGeneral.mutate(
      {
        emailNotifications: notifications.emailNotifications,
        digestFrequency: notifications.digestFrequency,
        theme,
      },
      {
        onError: (err) =>
          setError(err instanceof Error ? err.message : "Failed to save preferences."),
        onSuccess: () =>
          updateTenant.mutate(
            { timezone: timezone.trim() || undefined, language },
            {
              onError: (err) =>
                setError(err instanceof Error ? err.message : "Invalid regional settings."),
              onSuccess: () => {
                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
              },
            }
          ),
      }
    );
  };

  const saving = updateGeneral.isPending || updateTenant.isPending;

  if (isLoading) {
    return (
      <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
          <PageHeader title="General Settings" description="Configure your workspace preferences." />
          <div className="flex h-48 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="General Settings"
          description="Configure your workspace preferences."
        />

        {/* Regional */}
        <div className="zoiko-card p-6">
          <div className="mb-6 flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
              <Globe className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink)]">Regional</h3>
              <p className="text-[11px] text-[var(--ink3)]">Timezone and language for your workspace.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tz" className="mb-1 block text-sm font-medium text-[var(--ink2)]">
                Timezone
              </label>
              <input
                id="tz"
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. America/New_York"
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
              <p className="mt-1 text-[11px] text-[var(--ink3)]">IANA name, e.g. Europe/Berlin.</p>
            </div>
            <div>
              <label htmlFor="lang" className="mb-1 block text-sm font-medium text-[var(--ink2)]">
                Language
              </label>
              <select
                id="lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="zoiko-card p-6">
          <div className="mb-6 flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--ai-soft)] text-[var(--ai)]">
              <Bell className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink)]">Notifications</h3>
              <p className="text-[11px] text-[var(--ink3)]">Control how you receive updates.</p>
            </div>
          </div>
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center justify-between rounded-lg bg-[var(--s2)] px-4 py-3">
              <div>
                <span className="text-sm text-[var(--ink2)]">Email notifications</span>
                <p className="text-[11px] text-[var(--ink3)]">Receive email alerts for important events.</p>
              </div>
              <div
                role="switch"
                aria-checked={notifications.emailNotifications}
                tabIndex={0}
                className={`zoiko-toggle ${notifications.emailNotifications ? "on" : ""}`}
                onClick={() =>
                  setNotifications((p) => ({
                    ...p,
                    emailNotifications: !p.emailNotifications,
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setNotifications((p) => ({
                      ...p,
                      emailNotifications: !p.emailNotifications,
                    }));
                  }
                }}
              >
                <i />
              </div>
            </label>

            <div className="pt-1">
              <span className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--ink3)]">
                <Clock className="h-3.5 w-3.5" /> Digest frequency
              </span>
              <div className="space-y-2">
                {(["daily", "weekly", "none"] as const).map((freq) => (
                  <label
                    key={freq}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition ${
                      notifications.digestFrequency === freq
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border)] bg-[var(--s2)] hover:border-[var(--ink3)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="digest"
                      checked={notifications.digestFrequency === freq}
                      onChange={() =>
                        setNotifications((p) => ({ ...p, digestFrequency: freq }))
                      }
                      className="accent-[var(--accent)]"
                    />
                    <div>
                      <span className="text-sm font-medium capitalize text-[var(--ink)]">{freq}</span>
                      {freq === "daily" && (
                        <p className="text-[11px] text-[var(--ink3)]">Receive a daily summary every morning.</p>
                      )}
                      {freq === "weekly" && (
                        <p className="text-[11px] text-[var(--ink3)]">Receive a weekly summary every Monday.</p>
                      )}
                      {freq === "none" && (
                        <p className="text-[11px] text-[var(--ink3)]">No digest emails. Check the dashboard manually.</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="zoiko-card p-6">
          <div className="mb-6 flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--warn-soft)] text-[var(--warn)]">
              <Palette className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink)]">Appearance</h3>
              <p className="text-[11px] text-[var(--ink3)]">
                Changes apply instantly. Save to remember your choice across devices.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                { value: "light", label: "Light", hint: "Bright interface", Icon: Sun },
                { value: "dark", label: "Dark", hint: "Low-light friendly", Icon: Moon },
                { value: "system", label: "System", hint: "Match device setting", Icon: Monitor },
              ] as const
            ).map(({ value, label, hint, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleThemeSelect(value)}
                aria-pressed={theme === value}
                className={`flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition ${
                  theme === value
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--s2)] hover:border-[var(--ink3)]"
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${theme === value ? "text-[var(--accent-ink)]" : "text-[var(--ink3)]"}`}
                />
                <span className="mt-1 text-sm font-medium text-[var(--ink)]">{label}</span>
                <span className="text-[11px] text-[var(--ink3)]">{hint}</span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] px-3 py-2 text-sm text-[var(--crit)]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="zoiko-btn pri">
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save Settings"}
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-[var(--ok)]">
              <CheckCircle2 className="h-3.5 w-3.5" /> Settings saved.
            </span>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
