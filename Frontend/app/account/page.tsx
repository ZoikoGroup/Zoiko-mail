import { redirect } from "next/navigation";

/** The old Profile page; Profile now lives in Settings, inside Mail. */
export default function AccountPage() {
  redirect("/mail/settings/profile");
}
