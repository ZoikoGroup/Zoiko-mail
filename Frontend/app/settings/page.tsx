import { redirect } from "next/navigation";

/** The old Settings page; Settings now lives inside Mail. */
export default function SettingsPage() {
  redirect("/mail/settings/mailbox-preferences");
}
