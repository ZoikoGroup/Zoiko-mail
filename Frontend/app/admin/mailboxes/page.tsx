"use client";

import { useMailboxes } from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import { DASHBOARD } from "@/lib/admin-api";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  StaticNote,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/admin/ui";

export default function AdminMailboxesPage() {
  const can = useCan();
  const { data: mailboxes, isLoading, error } = useMailboxes();
  const seats = DASHBOARD.counts.mailboxSeats;
  const suspended = mailboxes?.filter((m) => m.status === "SUSPENDED") ?? [];

  return (
    <>
      <PageHeader
        title="Mailboxes"
        subtitle="Provider-backed hosted mailboxes under acme.test and zoikomail.com"
        action={
          can("workspace.mailboxes.manage") ? (
            <button type="button" className="zoiko-btn pri">
              Create mailbox
            </button>
          ) : undefined
        }
      />

      <StaticNote>
        Shared mailboxes need the schema rework — Mailbox.membershipId is currently unique
      </StaticNote>

      <Card
        title={mailboxes ? `${mailboxes.length} mailboxes` : "Mailboxes"}
        badge={mailboxes ? <Pill tone="nu">{`${mailboxes.length} of ${seats} seats`}</Pill> : undefined}
      >
        {error ? (
          <ErrorState message={error.message} />
        ) : isLoading || !mailboxes ? (
          <LoadingRows rows={5} />
        ) : mailboxes.length === 0 ? (
          <EmptyState title="No mailboxes yet" hint="Create one on a verified domain." />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Address</Th>
                  <Th>Type</Th>
                  <Th>Quota</Th>
                  <Th>AI</Th>
                  <Th>Status</Th>
                  <Th srOnly>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {mailboxes.map((mailbox) => (
                  <tr key={mailbox.id}>
                    <Td nowrap>
                      <span className="font-semibold text-[var(--ink)]">{mailbox.address}</span>
                    </Td>
                    <Td muted>
                      {mailbox.type === "SHARED" ? "Shared" : "Individual"}
                    </Td>
                    <Td mono muted nowrap>
                      {mailbox.storageUsedGb} / {mailbox.storageLimitGb} GB
                    </Td>
                    <Td>
                      <Pill tone={mailbox.aiEnabled ? "ai" : "nu"}>
                        {mailbox.aiEnabled ? "On" : "Off"}
                      </Pill>
                    </Td>
                    <Td>
                      <Pill tone={mailbox.status === "ACTIVE" ? "ok" : "crit"}>
                        {mailbox.status === "ACTIVE" ? "Active" : "Suspended"}
                      </Pill>
                    </Td>
                    <Td nowrap>
                      <button
                        type="button"
                        className="zoiko-btn sm"
                        disabled={!can("workspace.mailboxes.manage")}
                      >
                        Manage
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {suspended.map((mailbox) => (
        <Notice key={mailbox.id} tone="warn">
          <b className="text-[var(--warn)]">{mailbox.address} is send-suspended.</b>{" "}
          {mailbox.sendSuspensionReason ?? "Reason not recorded."} Reactivation needs a recorded
          approver.
        </Notice>
      ))}
    </>
  );
}
