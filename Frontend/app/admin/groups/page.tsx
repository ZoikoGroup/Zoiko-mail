"use client";

import { useGroups } from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import {
  Card,
  InlineEmpty,
  InlineError,
  LoadingRows,
  PageHeader,
  Pill,
  Row,
  StaticNote,
} from "@/components/admin/ui";

export default function AdminGroupsPage() {
  const can = useCan();
  const { data: groups, isLoading, error } = useGroups();

  return (
    <>
      <PageHeader
        title="Groups"
        subtitle="Shared mailboxes and distribution groups"
        action={
          can("workspace.groups.manage") ? (
            <button type="button" className="zoiko-btn pri">
              New group
            </button>
          ) : undefined
        }
      />

      <StaticNote>
        No MailGroup model exists yet — this screen is furthest from real data
      </StaticNote>

      <Card
        title={groups ? `${groups.length} groups` : "Groups"}
        badge={groups ? <Pill tone="nu">{`${groups.filter((g) => g.kind === "SHARED").length} shared`}</Pill> : undefined}
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
            <Row
              key={group.id}
              title={group.address}
              detail={`${group.memberCount} members · ${
                group.kind === "SHARED" ? "shared mailbox" : "distribution only"
              }`}
              right={
                <>
                  <Pill tone={group.status === "ACTIVE" ? "ok" : "crit"}>
                    {group.status === "ACTIVE" ? "Active" : "Suspended"}
                  </Pill>
                  <button
                    type="button"
                    className="zoiko-btn sm"
                    disabled={!can("workspace.groups.manage")}
                  >
                    Manage
                  </button>
                </>
              }
            />
          ))
        )}
      </Card>
    </>
  );
}
