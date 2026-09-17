"use client";

import { useState } from "react";

import {
  useCreateAlias,
  useCreateForwarding,
  useDeleteAlias,
  useDeleteForwarding,
  useMailboxes,
  useMailboxRouting,
  useSetMailboxAi,
} from "@/lib/admin-hooks";
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
  const [openId, setOpenId] = useState<string | null>(null);
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
        Shared mailboxes live on the Groups screen, where assignments and their
        read/send/manage/assign permissions are managed
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
                        onClick={() => setOpenId(openId === mailbox.id ? null : mailbox.id)}
                      >
                        {openId === mailbox.id ? "Close" : "Manage"}
                      </button>
                    </Td>
                  </tr>
                ))}
                {/* Rendered as its own row so the panel spans the table
                    rather than squeezing into the actions column. */}
                {mailboxes
                  .filter((mailbox) => mailbox.id === openId)
                  .map((mailbox) => (
                    <tr key={`${mailbox.id}-routing`}>
                      <td colSpan={6} className="bg-[var(--s1)] px-4 py-3">
                        <Routing mailboxId={mailbox.id} address={mailbox.address} />
                      </td>
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


/* ── aliases and forwarding ────────────────────────────────────────────── */

/**
 * The routing attached to one mailbox.
 *
 * Aliases and forwarding sit together because they answer the same question
 * from opposite ends: which addresses arrive here, and where does what
 * arrives get sent on to. Forwarding is the one an operator should look at
 * twice, which is why the server audits its creation by name (Security §9).
 */
function Routing({ mailboxId, address }: { mailboxId: string; address: string }) {
  const { data, isLoading, error } = useMailboxRouting(mailboxId);
  const createAlias = useCreateAlias();
  const deleteAlias = useDeleteAlias();
  const createForwarding = useCreateForwarding();
  const deleteForwarding = useDeleteForwarding();

  const [alias, setAlias] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [keepCopy, setKeepCopy] = useState(true);

  const failure =
    (createAlias.error ?? deleteAlias.error ?? createForwarding.error ?? deleteForwarding.error) as
      | Error
      | undefined;

  if (error) return <InlineError message={error.message} />;
  if (isLoading || !data) return <LoadingRows rows={2} />;

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h4 className="font-mono-num mb-2 text-[10px] uppercase tracking-wider text-[var(--ink3)]">
          Aliases — other addresses that arrive at {address}
        </h4>
        {data.aliases.length === 0 ? (
          <p className="text-[11.5px] text-[var(--ink3)]">No aliases.</p>
        ) : (
          <ul className="mb-2 flex flex-wrap gap-2">
            {data.aliases.map((entry) => (
              <li key={entry.id} className="flex items-center gap-1.5">
                <Pill tone="nu">{entry.address}</Pill>
                <button
                  type="button"
                  className="zoiko-btn sm"
                  disabled={deleteAlias.isPending}
                  onClick={() => deleteAlias.mutate({ mailboxId, aliasId: entry.id })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            createAlias.mutate(
              { mailboxId, address: alias.trim() },
              { onSuccess: () => setAlias("") }
            );
          }}
        >
          <input
            className="zoiko-input"
            placeholder="sales@acme.test"
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            required
          />
          <button type="submit" className="zoiko-btn sm" disabled={createAlias.isPending}>
            Add alias
          </button>
        </form>
      </section>

      <section>
        <h4 className="font-mono-num mb-2 text-[10px] uppercase tracking-wider text-[var(--ink3)]">
          Forwarding — where mail arriving here is sent on
        </h4>
        {data.forwarding.length === 0 ? (
          <p className="text-[11.5px] text-[var(--ink3)]">No forwarding.</p>
        ) : (
          <ul className="mb-2 flex flex-col gap-1.5">
            {data.forwarding.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-2">
                <Pill tone="nu">{rule.forwardToAddress}</Pill>
                <span className="text-[11px] text-[var(--ink3)]">
                  {rule.keepCopy ? "copy kept in this mailbox" : "not kept in this mailbox"}
                </span>
                <button
                  type="button"
                  className="zoiko-btn sm"
                  disabled={deleteForwarding.isPending}
                  onClick={() => deleteForwarding.mutate({ mailboxId, ruleId: rule.id })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            createForwarding.mutate(
              { mailboxId, forwardToAddress: forwardTo.trim(), keepCopy },
              { onSuccess: () => setForwardTo("") }
            );
          }}
        >
          <input
            className="zoiko-input"
            placeholder="archive@example.test"
            value={forwardTo}
            onChange={(event) => setForwardTo(event.target.value)}
            required
          />
          <label className="flex items-center gap-1 text-[11px]">
            <input
              type="checkbox"
              checked={keepCopy}
              onChange={(event) => setKeepCopy(event.target.checked)}
            />
            Keep a copy
          </label>
          <button type="submit" className="zoiko-btn sm" disabled={createForwarding.isPending}>
            Add forwarding
          </button>
        </form>
      </section>

      {failure && (
        <Notice tone="crit">
          <b className="text-[var(--crit)]">Could not change routing.</b> {failure.message}
        </Notice>
      )}
    </div>
  );
}
