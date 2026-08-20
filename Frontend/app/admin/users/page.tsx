"use client";

import Link from "next/link";
import { useWorkspacePeople } from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import type { MemberDto, MfaMethod, MembershipRole } from "@/lib/admin-api";
import {
  Card,
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
  type Tone,
} from "@/components/admin/ui";

const ROLE_TONE: Record<MembershipRole, Tone> = {
  OWNER: "accent",
  ADMIN: "ai",
  MEMBER: "nu",
  SUPPORT: "warn",
};

const MFA_LABEL: Record<MfaMethod, { label: string; tone: Tone }> = {
  PASSKEY: { label: "Passkey", tone: "ok" },
  TOTP: { label: "TOTP", tone: "warn" },
  NONE: { label: "None", tone: "crit" },
};

export default function AdminUsersPage() {
  const can = useCan();
  const { data: people, isLoading, error } = useWorkspacePeople();

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Every person with a membership in this workspace"
        action={
          can("people.invite.member") ? (
            <Link href="/admin/invitations" className="zoiko-btn pri">
              Invite user
            </Link>
          ) : undefined
        }
      />

      <StaticNote>
        GET /membership/members returns every membership — this screen filters INVITED and SUPPORT
      </StaticNote>

      <Card
        title={people ? `${people.length} people` : "People"}
        badge={people ? <Pill tone="nu">{`Showing ${people.length}`}</Pill> : undefined}
        action={<button type="button" className="zoiko-btn sm">Export</button>}
      >
        {error ? (
          <InlineError message={error.message} />
        ) : isLoading || !people ? (
          <LoadingRows rows={6} />
        ) : people.length === 0 ? (
          <Notice tone="info">No active members yet. Invite someone to get started.</Notice>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Role</Th>
                  <Th>MFA</Th>
                  <Th>Last active</Th>
                  <Th srOnly>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <PersonRow key={person.id} person={person} can={can} />
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Notice tone="info">
        <b className="text-[var(--ai)]">Manage is disabled on Owner rows.</b> An Admin cannot
        suspend, demote or remove an Owner — and the API refuses it too, not just the button.
      </Notice>
    </>
  );
}

function PersonRow({
  person,
  can,
}: {
  person: MemberDto;
  can: (capability: "people.owner.manage" | "people.admin.manage" | "people.member.manage") => boolean;
}) {
  const mfa = MFA_LABEL[person.mfaMethod];

  // Capability, never role: acting on a senior member needs the matching grant.
  const manageable =
    person.role === "OWNER"
      ? can("people.owner.manage")
      : person.role === "ADMIN"
        ? can("people.admin.manage")
        : can("people.member.manage");

  return (
    <tr>
      <Td>
        <div className="font-semibold text-[var(--ink)]">{person.user.displayName}</div>
        <div className="font-mono-num text-[10.5px] text-[var(--ink3)]">{person.user.email}</div>
      </Td>
      <Td>
        <Pill tone={ROLE_TONE[person.role]}>
          {person.role.charAt(0) + person.role.slice(1).toLowerCase()}
        </Pill>
      </Td>
      <Td>
        <Pill tone={mfa.tone}>{mfa.label}</Pill>
      </Td>
      <Td mono muted nowrap>
        {person.lastActiveAt ?? "—"}
      </Td>
      <Td nowrap>
        <button
          type="button"
          className="zoiko-btn sm"
          disabled={!manageable}
          title={manageable ? undefined : "Admins cannot act on an Owner"}
        >
          Manage
        </button>
      </Td>
    </tr>
  );
}
