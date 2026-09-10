"use client";

import { useMailboxes, useSetMailboxAi } from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import {
  Card,
  InlineEmpty,
  InlineError,
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
  const setAi = useSetMailboxAi();
  const canManage = can("workspace.mailboxes.manage");
  const suspended = mailboxes?.filter((m) => m.status === "SUSPENDED") ?? [];

  return (
    <>
      <PageHeader
        title="Mailboxes"
        subtitle="Provider-backed hosted mailboxes under acme.test and zoikomail.com"
        action={
          canManage ? (
            <button type="button" className="zoiko-btn pri">
              Create mailbox
            </button>
          ) : undefined
        }
      />

      <StaticNote>
        Shared mailboxes need the schema rework — Mailbox.membershipId is currently unique
      </StaticNote>

      {setAi.isError && (
        <Notice tone="crit">
          <b className="text-[var(--crit)]">Could not change AI access.</b>{" "}
          {(setAi.error as Error).message}
        </Notice>
      )}

      <Card
        title={mailboxes ? `${mailboxes.length} mailboxes` : "Mailboxes"}
        // Seat entitlement lives with billing, which is the Owner's domain and has
        // no endpoint. Showing the provisioned count alone beats inventing a cap.
        badge={mailboxes ? <Pill tone="nu">{`${mailboxes.length} provisioned`}</Pill> : undefined}
      >
        {error ? (
          <InlineError message={error.message} />
        ) : isLoading || !mailboxes ? (
          <LoadingRows rows={5} />
        ) : mailboxes.length === 0 ? (
          <InlineEmpty title="No mailboxes yet" hint="Create one on a verified domain." />
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
                      {/*
                        A control, not a label. Turning this off is what makes
                        a mailbox restricted (AC-008): the AI service refuses
                        to process it, and the change is audited with both the
                        old and the new value.
                      */}
                      <button
                        type="button"
                        disabled={!canManage || setAi.isPending}
                        aria-pressed={mailbox.aiEnabled}
                        aria-label={`AI processing for ${mailbox.address}`}
                        title={
                          canManage
                            ? mailbox.aiEnabled
                              ? "Restrict this mailbox from AI processing"
                              : "Allow AI to process this mailbox"
                            : "Requires workspace.mailboxes.manage"
                        }
                        onClick={() =>
                          setAi.mutate({
                            mailboxId: mailbox.id,
                            aiEnabled: !mailbox.aiEnabled,
                          })
                        }
                        className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Pill tone={mailbox.aiEnabled ? "ai" : "nu"}>
                          {mailbox.aiEnabled ? "On" : "Off"}
                        </Pill>
                      </button>
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
                        disabled={!canManage}
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
