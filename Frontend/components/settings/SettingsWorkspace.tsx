"use client";

import type { ReactNode } from "react";
import { WebmailShell } from "@/components/mail/WebmailShell";
import Link from "next/link";
import { SettingsHeader } from "@/components/settings/SettingsBits";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/components/settings/sections";

/**
 * Every Settings page: the Mail shell with this page highlighted under
 * SETTINGS in the folder column, its header, and the page body below.
 */
export function SettingsWorkspace({
  section,
  actions,
  children,
}: {
  section: SettingsSection;
  /** The header's right-hand buttons, such as Discard / Save changes. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <WebmailShell section="mail" settingsSection={section.key}>
      <div className="flex h-full min-h-0 flex-col overflow-y-auto px-4 pb-6 pt-5 lg:px-6" data-testid="settings-page">
        {/* Phones only: the desktop has the Settings list in its folder column. */}
        <nav aria-label="Settings sections" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden" data-testid="settings-tabs">
          {SETTINGS_SECTIONS.map((s) => {
            const current = s.key === section.key;
            const Icon = s.icon;
            return (
              <Link
                key={s.key}
                href={s.href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  current
                    ? "border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                    : "border-[var(--border)] text-[var(--ink2)] hover:bg-[var(--s2)]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {s.label}
              </Link>
            );
          })}
        </nav>
        <SettingsHeader section={section} actions={actions} />
        <div className="mt-5 flex min-h-0 flex-1 flex-col gap-4">{children}</div>
      </div>
    </WebmailShell>
  );
}
