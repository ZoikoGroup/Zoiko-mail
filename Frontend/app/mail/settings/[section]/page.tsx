"use client";

import { notFound } from "next/navigation";
import { MailPreferencesProvider } from "@/lib/mail-preferences";
import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { MailboxPreferences } from "@/components/settings/MailboxPreferences";
import { ConnectedMailboxes } from "@/components/settings/ConnectedMailboxes";
import { SenderIdentities } from "@/components/settings/SenderIdentities";
import { settingsSection, type SettingsSection, type SettingsSectionKey } from "@/components/settings/sections";

const PAGES: Record<SettingsSectionKey, (props: { section: SettingsSection }) => JSX.Element> = {
  "mailbox-preferences": MailboxPreferences,
  "connected-mailboxes": ConnectedMailboxes,
  "sender-identities": SenderIdentities,
  profile: ProfileSettings,
};

/** /mail/settings/<section> — one of the member's personal Settings pages. */
export default function SettingsSectionPage({ params }: { params: { section: string } }) {
  const section = settingsSection(params.section);
  if (!section) notFound();
  const Page = PAGES[section.key];
  // Above the page, not only in its shell: Mailbox Preferences reads and
  // saves these from outside the shell it renders.
  return (
    <MailPreferencesProvider>
      <Page section={section} />
    </MailPreferencesProvider>
  );
}
