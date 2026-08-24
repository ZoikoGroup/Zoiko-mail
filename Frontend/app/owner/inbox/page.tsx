"use client";

import { useEffect } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { MailClient } from "@/components/mail/MailClient";

/**
 * The Owner's own inbox/webmail, rendered inside the owner shell.
 *
 * Reuses the same shell-free MailClient as /mail and /admin/inbox so reading
 * mail never ejects the user out of the owner dashboard rail.
 */
export default function OwnerInboxPage() {
  useEffect(() => { document.title = "Inbox | Zoiko Mail"; }, []);

  return (
    <ProtectedRoute>
      <div className="flex h-full min-h-0 flex-col">
        <MailClient />
      </div>
    </ProtectedRoute>
  );
}
