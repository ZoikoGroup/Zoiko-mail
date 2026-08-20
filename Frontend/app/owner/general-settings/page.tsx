"use client";

import { useState, useEffect } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { useMe } from "@/lib/auth-hooks";
import { useUpdateTenant } from "@/lib/owner-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { Bell, Palette, Save, Globe, Clock } from "lucide-react";

const SETTINGS_KEY = "zoiko.general_settings";

interface GeneralSettings {
  emailNotifications: boolean;
  digestFrequency: "daily" | "weekly" | "none";
}

function loadSettings(): GeneralSettings {
  if (typeof window === "undefined") return { emailNotifications: true, digestFrequency: "daily" };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { emailNotifications: true, digestFrequency: "daily" };
}

function saveSettings(s: GeneralSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}

export default function GeneralSettingsPage() {
  const { data, isLoading } = useMe();
  const me = data as MeResponse | undefined;
  const updateTenant = useUpdateTenant();
  const [settings, setSettings] = useState<GeneralSettings>({ emailNotifications: true, digestFrequency: "daily" });
  const [saved, setSaved] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized) {
      setSettings(loadSettings());
      setInitialized(true);
    }
  }, [initialized]);

  const handleToggle = (key: keyof GeneralSettings) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveSettings(next);
      return next;
    });
  };

  const handleDigestChange = (freq: GeneralSettings["digestFrequency"]) => {
    const next = { ...settings, digestFrequency: freq };
    setSettings(next);
    saveSettings(next);
  };

  const handleSave = () => {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (isLoading) {
    return (
      <ProtectedRoute>
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
    <ProtectedRoute>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="General Settings"
          description="Configure your workspace preferences."
        />

        <div className="zoiko-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
              <Bell className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink)]">Notifications</h3>
              <p className="text-[11px] text-[var(--ink3)]">Control how you receive notifications.</p>
            </div>
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between rounded-lg bg-[var(--s2)] px-4 py-3">
              <div>
                <span className="text-sm text-[var(--ink2)]">Email notifications</span>
                <p className="text-[11px] text-[var(--ink3)]">Receive email alerts for important events.</p>
              </div>
              <div
                className={`zoiko-toggle ${settings.emailNotifications ? "on" : ""}`}
                onClick={() => handleToggle("emailNotifications")}
              >
                <i />
              </div>
            </label>
          </div>
        </div>

        <div className="zoiko-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--ai-soft)] text-[var(--ai)]">
              <Clock className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink)]">Digest Frequency</h3>
              <p className="text-[11px] text-[var(--ink3)]">How often you receive a summary of activity.</p>
            </div>
          </div>
          <div className="space-y-2">
            {(["daily", "weekly", "none"] as const).map((freq) => (
              <label
                key={freq}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition cursor-pointer ${
                  settings.digestFrequency === freq
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] bg-[var(--s2)] hover:border-[var(--ink3)]"
                }`}
              >
                <input
                  type="radio"
                  name="digest"
                  checked={settings.digestFrequency === freq}
                  onChange={() => handleDigestChange(freq)}
                  className="accent-[var(--accent)]"
                />
                <div>
                  <span className="text-sm font-medium text-[var(--ink)] capitalize">{freq}</span>
                  {freq === "daily" && <p className="text-[11px] text-[var(--ink3)]">Receive a daily summary every morning.</p>}
                  {freq === "weekly" && <p className="text-[11px] text-[var(--ink3)]">Receive a weekly summary every Monday.</p>}
                  {freq === "none" && <p className="text-[11px] text-[var(--ink3)]">No digest emails. Check the dashboard manually.</p>}
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="zoiko-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--ai-soft)] text-[var(--ai)]">
              <Palette className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink)]">Appearance</h3>
              <p className="text-[11px] text-[var(--ink3)]">Customize the look and feel.</p>
            </div>
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between rounded-lg bg-[var(--s2)] px-4 py-3">
              <span className="text-sm text-[var(--ink2)]">Dark mode</span>
              <span className="text-[11px] text-[var(--ink3)]">Use the theme toggle in the header.</span>
            </label>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="zoiko-btn pri"
        >
          <Save className="h-3.5 w-3.5" />
          Save Settings
        </button>
        {saved && <span className="text-xs text-[var(--ok)]">Settings saved.</span>}
      </div>
    </ProtectedRoute>
  );
}
