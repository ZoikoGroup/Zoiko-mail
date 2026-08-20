"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { useMe } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { Sliders, Bell, Palette, Save } from "lucide-react";

export default function GeneralSettingsPage() {
  const { data } = useMe();
  const me = data as MeResponse | undefined;
  const [saved, setSaved] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

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
              <span className="text-sm text-[var(--ink2)]">Email notifications</span>
              <div
                className={`zoiko-toggle ${notifications ? "on" : ""}`}
                onClick={() => setNotifications(!notifications)}
              >
                <i />
              </div>
            </label>
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
              <div
                className={`zoiko-toggle ${darkMode ? "on" : ""}`}
                onClick={() => setDarkMode(!darkMode)}
              >
                <i />
              </div>
            </label>
          </div>
        </div>

        <button
          onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}
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
