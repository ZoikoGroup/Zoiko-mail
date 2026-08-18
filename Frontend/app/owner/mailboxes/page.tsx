"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { MailboxesTable } from "@/components/owner/mailboxes/MailboxesTable";
import { CreateMailboxModal } from "@/components/owner/mailboxes/CreateMailboxModal";

export default function MailboxesPage() {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Mailboxes"
          description="Create and manage mailboxes across your organization."
        />
        <MailboxesTable onCreateMailbox={() => setCreateOpen(true)} />
        <CreateMailboxModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSubmit={(data) => {
            // TODO: wire to create mailbox API
            console.log("Create mailbox:", data);
            setCreateOpen(false);
          }}
        />
      </div>
    </ProtectedRoute>
  );
}
