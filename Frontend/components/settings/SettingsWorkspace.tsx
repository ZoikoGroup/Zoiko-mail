"use client";

import type { ReactNode } from "react";
import { WebmailShell } from "@/components/mail/WebmailShell";
import { SettingsHeader } from "@/components/settings/SettingsBits";
import type { SettingsSection } from "@/components/settings/sections";

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
        <SettingsHeader section={section} actions={actions} />
        <div className="mt-5 flex min-h-0 flex-1 flex-col gap-4">{children}</div>
      </div>
    </WebmailShell>
  );
}
