import { redirect } from "next/navigation";

/**
 * Retired per-mailbox Member sign-in links (/login/member/<key>).
 *
 * The Member sign-in is now one plain /login/member for everyone. Links that
 * were already handed out still work: they redirect there on the server, so
 * the key never renders and the address bar shows the clean URL.
 */
export default function RetiredMemberLoginLinkPage(): never {
  redirect("/login/member");
}
