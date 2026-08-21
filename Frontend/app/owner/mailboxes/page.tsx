"use client";

import { useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { MailboxesTable } from "@/components/owner/mailboxes/MailboxesTable";
import { CreateMailboxModal } from "@/components/owner/mailboxes/CreateMailboxModal";
import { useCreateAdminMailbox, useMembers, useAdminMailboxes } from "@/lib/owner-hooks";

export default function MailboxesPage() {
  useEffect(() => { document.title = "Mailboxes | Zoiko Mail"; }, []);
  const [createOpen, setCreateOpen] = useState(false);

  const createMailbox = useCreateAdminMailbox();
  const { data: members = [] } = useMembers();
  const { data: mailboxes = [] } = useAdminMailboxes();

  const membersWithoutMailbox = members.filter(
    (m) => m.status === "ACTIVE" && !mailboxes.some((mb) => mb.userId === m.userId)
  );

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
          members={membersWithoutMailbox}
          onSubmit={(membershipId) => {
            createMailbox.mutate(membershipId, {
              onSuccess: () => setCreateOpen(false),
            });
          }}
          loading={createMailbox.isPending}
        />
      </div>
    </ProtectedRoute>
  );
}
