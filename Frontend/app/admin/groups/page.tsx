"use client";

import { useState } from "react";

import {
  useAssignToGroup,
  useCreateGroup,
  useGroupAssignees,
  useGroups,
  useRemoveFromGroup,
  useWorkspacePeople,
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
  Row,
} from "@/components/admin/ui";

/**
 * Shared mailboxes and distribution addresses.
 *
 * This screen used to say "No MailGroup model exists yet — this screen is
 * furthest from real data", and it was right. There is still no separate
 * Group entity: Data Model §6.16 models both as a mailbox with a type, which
 * is the same shared/distribution split this screen already drew.
 */
export default function AdminGroupsPage() {
  const can = useCan();
  const canManage = can("workspace.groups.manage");
  const { data: groups, isLoading, error } = useGroups();

  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Groups"
        subtitle="Shared mailboxes and distribution groups"
        action={
          canManage ? (
            <button
              type="button"
              className="zoiko-btn pri"
              onClick={() => setCreating((open) => !open)}
            >
              {creating ? "Cancel" : "New group"}
            </button>
          ) : undefined
        }
      />

      {creating && <CreateGroup onDone={() => setCreating(false)} />}

      <Card
        title={groups ? `${groups.length} groups` : "Groups"}
        badge={
          groups ? (
            <Pill tone="nu">{`${groups.filter((g) => g.kind === "SHARED").length} shared`}</Pill>
          ) : undefined
        }
      >
        {error ? (
          <InlineError message={error.message} />
        ) : isLoading || !groups ? (
          <LoadingRows rows={4} />
        ) : groups.length === 0 ? (
          <InlineEmpty
            title="No groups yet"
            hint="Create a shared mailbox or a distribution address."
          />
        ) : (
          groups.map((group) => (
            <div key={group.id}>
              <Row
                title={group.address}
                detail={`${group.memberCount} ${
                  group.memberCount === 1 ? "member" : "members"
                } · ${group.kind === "SHARED" ? "shared mailbox" : "distribution only"}`}
                right={
                  <>
                    <Pill tone={group.status === "ACTIVE" ? "ok" : "crit"}>
                      {group.status === "ACTIVE" ? "Active" : "Suspended"}
                    </Pill>
                    <button
                      type="button"
                      className="zoiko-btn sm"
                      disabled={!canManage}
                      onClick={() => setOpenId(openId === group.id ? null : group.id)}
                    >
                      {openId === group.id ? "Close" : "Manage"}
                    </button>
                  </>
                }
              />
              {openId === group.id && <Assignees mailboxId={group.id} />}
            </div>
          ))
        )}
      </Card>
    </>
  );
}

/* ── create ────────────────────────────────────────────────────────────── */

function CreateGroup({ onDone }: { onDone: () => void }) {
  const create = useCreateGroup();
  const [address, setAddress] = useState("");
  const [type, setType] = useState<"SHARED" | "DISTRIBUTION">("SHARED");

  return (
    <Card title="New group">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            { address: address.trim(), type },
            { onSuccess: () => { setAddress(""); onDone(); } }
          );
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-wide text-[var(--ink3)]">
            Address
          </span>
          <input
            id="group-address"
            className="zoiko-input"
            placeholder="support@acme.test"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-wide text-[var(--ink3)]">
            Kind
          </span>
          <select
            id="group-type"
            className="zoiko-input"
            value={type}
            onChange={(event) => setType(event.target.value as "SHARED" | "DISTRIBUTION")}
          >
            <option value="SHARED">Shared mailbox</option>
            <option value="DISTRIBUTION">Distribution only</option>
          </select>
        </label>
        <button type="submit" className="zoiko-btn pri" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create"}
        </button>
      </form>
      {create.isError && (
        <Notice tone="crit">
          <b className="text-[var(--crit)]">Could not create the group.</b>{" "}
          {(create.error as Error).message}
        </Notice>
      )}
    </Card>
  );
}

/* ── assignees ─────────────────────────────────────────────────────────── */

const PERMISSIONS = [
  { key: "canRead", label: "Read" },
  { key: "canSend", label: "Send" },
  { key: "canManage", label: "Manage" },
  { key: "canAssign", label: "Assign" },
] as const;

/**
 * Who can reach this mailbox, and how.
 *
 * The four permissions are separate controls because Security §10 requires
 * them to be separable — a single "has access" switch would have collapsed
 * read-only triage and send-as-the-team into the same grant.
 */
function Assignees({ mailboxId }: { mailboxId: string }) {
  const { data: assignees, isLoading, error } = useGroupAssignees(mailboxId);
  const { data: people } = useWorkspacePeople();
  const assign = useAssignToGroup();
  const remove = useRemoveFromGroup();

  const assignedIds = new Set((assignees ?? []).map((a) => a.membershipId));
  const addable = (people ?? []).filter((p) => !assignedIds.has(p.id));

  return (
    <div className="border-t border-[var(--line)] bg-[var(--s1)] px-4 py-3">
      {error ? (
        <InlineError message={error.message} />
      ) : isLoading || !assignees ? (
        <LoadingRows rows={2} />
      ) : (
        <>
          {assignees.length === 0 ? (
            <p className="text-[11.5px] text-[var(--ink3)]">
              Nobody is assigned yet. Until someone is, this mailbox is reachable by no
              one — a workspace role is not access to it.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {assignees.map((assignee) => (
                <li
                  key={assignee.membershipId}
                  className="flex flex-wrap items-center gap-3"
                >
                  <span className="min-w-40 text-[12px] text-[var(--ink)]">
                    {assignee.name}
                    <span className="ml-1 text-[var(--ink3)]">{assignee.email}</span>
                  </span>
                  {PERMISSIONS.map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-1 text-[11px]">
                      <input
                        type="checkbox"
                        checked={assignee[key]}
                        disabled={assign.isPending}
                        onChange={(event) =>
                          assign.mutate({
                            mailboxId,
                            membershipId: assignee.membershipId,
                            canRead: assignee.canRead,
                            canSend: assignee.canSend,
                            canManage: assignee.canManage,
                            canAssign: assignee.canAssign,
                            [key]: event.target.checked,
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                  <button
                    type="button"
                    className="zoiko-btn sm"
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate({ mailboxId, membershipId: assignee.membershipId })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {addable.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <select
                id={`add-assignee-${mailboxId}`}
                className="zoiko-input"
                defaultValue=""
                onChange={(event) => {
                  if (!event.target.value) return;
                  assign.mutate({ mailboxId, membershipId: event.target.value });
                  event.target.value = "";
                }}
              >
                <option value="">Add someone…</option>
                {addable.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.user.displayName} · {person.user.email}
                  </option>
                ))}
              </select>
              <span className="text-[10.5px] text-[var(--ink3)]">
                Added read-only; widen above.
              </span>
            </div>
          )}

          {(assign.isError || remove.isError) && (
            <Notice tone="crit">
              <b className="text-[var(--crit)]">Could not change access.</b>{" "}
              {((assign.error ?? remove.error) as Error).message}
            </Notice>
          )}
        </>
      )}
    </div>
  );
}
