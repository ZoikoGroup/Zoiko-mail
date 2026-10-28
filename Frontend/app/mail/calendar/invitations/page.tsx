"use client";

import { Suspense } from "react";
import { WebmailLoading } from "@/components/mail/WebmailLoading";
import { InvitationsPage } from "@/components/calendar/InvitationsPage";

/** /mail/calendar/invitations — Invitations & RSVP. ?event=<id> opens one. */
export default function CalendarInvitationsPage() {
  return (
    <Suspense fallback={<WebmailLoading />}>
      <InvitationsPage />
    </Suspense>
  );
}
