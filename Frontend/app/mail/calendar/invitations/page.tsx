"use client";

import { Suspense } from "react";
import { InvitationsPage } from "@/components/calendar/InvitationsPage";

/** /mail/calendar/invitations — Invitations & RSVP. ?event=<id> opens one. */
export default function CalendarInvitationsPage() {
  return (
    <Suspense>
      <InvitationsPage />
    </Suspense>
  );
}
