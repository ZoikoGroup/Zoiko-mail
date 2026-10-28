import { redirect } from "next/navigation";

/**
 * The old Connected Accounts page, now Settings → Connected Mailboxes.
 *
 * Still the address Google and Microsoft sign-in return to (the backend's
 * OAuth callbacks redirect here), so the query string — ?connected=true&
 * provider=…, or ?error=… — is passed on for the new page to report.
 */
export default function ConnectedAccountsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  const qs = query.toString();
  redirect(`/mail/settings/connected-mailboxes${qs ? `?${qs}` : ""}`);
}
