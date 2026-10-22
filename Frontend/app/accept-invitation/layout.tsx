import type { Metadata } from "next";

// The URL carries a setup token: never send it on as a Referer, never index it.
export const metadata: Metadata = {
  title: "You're invited to Zoiko Mail",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function AcceptInvitationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
