"use client";

import { useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { MailboxesTable } from "@/components/owner/mailboxes/MailboxesTable";
import { CreateEmailWizard } from "@/components/mailboxes/CreateEmailWizard";

export default function MailboxesPage() {
  useEffect(() => { document.title = "Mailboxes | Zoiko Mail"; }, []);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Mailboxes"
          description="Create and manage mailboxes across your organization."
        />
        <MailboxesTable onCreateMailbox={() => setCreateOpen(true)} />
        {/* The same Create Email flow the Admin dashboard uses. */}
        {createOpen && (
          <CreateEmailWizard domainsHref="/owner/domains" onClose={() => setCreateOpen(false)} />
        )}
      </div>
    </ProtectedRoute>
  );
}
