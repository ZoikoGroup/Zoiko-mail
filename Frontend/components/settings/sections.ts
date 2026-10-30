import { SHOW_COMING_SOON } from "@/lib/feature-flags";
import {
  SlidersHorizontal, Mail, BadgeCheck, Plug, ArrowLeftRight, UserCircle, type LucideIcon,
} from "lucide-react";

/** The member's personal Settings, listed under SETTINGS in the folder column. */
export type SettingsSectionKey =
  | "mailbox-preferences"
  | "connected-mailboxes"
  | "sender-identities"
  | "integrations"
  | "import-export"
  | "profile";

export interface SettingsSection {
  key: SettingsSectionKey;
  /** In the folder column. */
  label: string;
  /** The page heading, which can say more than the column has room for. */
  title: string;
  subtitle: string;
  /** Second half of the "SETTINGS / …" line above the title. */
  eyebrow: string;
  /** Not built yet: listed only while SHOW_COMING_SOON is on. */
  soon?: boolean;
  icon: LucideIcon;
  href: string;
}

const section = (s: Omit<SettingsSection, "href">): SettingsSection => ({ ...s, href: `/mail/settings/${s.key}` });

const ALL_SETTINGS_SECTIONS: SettingsSection[] = [
  section({
    key: "mailbox-preferences",
    label: "Mailbox Preferences",
    title: "Mailbox Preferences",
    subtitle: "Choose how you organize, scan, and read your conversations.",
    eyebrow: "Personal preferences",
    icon: SlidersHorizontal,
  }),
  section({
    key: "connected-mailboxes",
    label: "Connected Mailboxes",
    title: "Connected Mailboxes",
    subtitle: "Accounts linked to your mailbox, and how they sync.",
    eyebrow: "Connected services",
    icon: Mail,
  }),
  section({
    key: "sender-identities",
    label: "Sender Identities",
    title: "Sender Identities",
    subtitle: "The addresses you can send mail from.",
    eyebrow: "Sending",
    icon: BadgeCheck,
  }),
  section({
    key: "integrations",
    soon: true,
    label: "Integrations & Apps",
    title: "Integrations & Connected Apps",
    subtitle: "Connect the tools you use. Review permissions, data flows, and connection health.",
    eyebrow: "Connected services",
    icon: Plug,
  }),
  section({
    key: "import-export",
    soon: true,
    label: "Import & Export",
    title: "Mail Import & Export",
    subtitle: "Transfer mail safely, create controlled exports, and review every migration job.",
    eyebrow: "Data portability",
    icon: ArrowLeftRight,
  }),
  section({
    key: "profile",
    label: "Profile",
    title: "Profile",
    subtitle: "Your account details and sign-in security.",
    eyebrow: "Account & security",
    icon: UserCircle,
  }),
];

/** The pages in use: the ones not built yet are left out unless SHOW_COMING_SOON is on. */
export const SETTINGS_SECTIONS = ALL_SETTINGS_SECTIONS.filter((s) => SHOW_COMING_SOON || !s.soon);

export const DEFAULT_SETTINGS_HREF = SETTINGS_SECTIONS[0]!.href;

export function settingsSection(key: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => s.key === key);
}
