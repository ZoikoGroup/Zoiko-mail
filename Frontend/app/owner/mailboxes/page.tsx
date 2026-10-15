"use client";

import { useEffect } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { MailboxesManager } from "@/components/mailboxes/MailboxesManager";

export default function MailboxesPage() {
  useEffect(() => { document.title = "Mailboxes | Zoiko Mail"; }, []);

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        {/* The same screen the Admin console has, with every mailbox action. */}
        <MailboxesManager domainsHref="/owner/domains" />
      </div>
    </ProtectedRoute>
  );
}
