import { redirect } from "next/navigation";
import { DEFAULT_SETTINGS_HREF } from "@/components/settings/sections";

/** /mail/settings opens the first Settings page, Mailbox Preferences. */
export default function SettingsIndexPage() {
  redirect(DEFAULT_SETTINGS_HREF);
}
