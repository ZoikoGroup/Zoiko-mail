"use client";

import { useState } from "react";

import { useCancelInvitation, useInvitations } from "@/lib/admin-hooks";
import { InviteMemberDialog } from "@/components/admin/InviteMemberDialog";
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
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export default function AdminInvitationsPage() {
  const can = useCan();
  const { data: invitations, isLoading, error } = useInvitations();
  const [inviting, setInviting] = useState(false);
  const [revoking, setRevoking] = useState<{ id: string; email: string } | null>(null);
  const cancel = useCancelInvitation();

  // The role ceiling is the whole point of this screen: an Admin may grant
  // Member and nothing above it. Rendered from capabilities so widening the
  // grant later is a server-side data change, not a UI edit. The dialog offers only
  // these; the server checks the boundary again, so this list decides what is
  // offered, never what is permitted.
  const grantableRoles = [
    can("people.invite.member") && ("MEMBER" as const),
    can("people.invite.admin") && ("ADMIN" as const),
    can("people.invite.owner") && ("OWNER" as const),
  ].filter(Boolean) as Array<"OWNER" | "ADMIN" | "MEMBER">;

  return (
    <>
      {inviting && (
        <InviteMemberDialog
          grantableRoles={grantableRoles}
          onClose={() => setInviting(false)}
        />
      )}

      <PageHeader
        title="Invitations"
        subtitle="Membership is granted, never claimed. Registering creates an account with no access."
        action={
          can("people.invite.member") ? (
            <button
              type="button"
              className="zoiko-btn pri"
              onClick={() => setInviting(true)}
            >
              New invitation
            </button>
          ) : undefined
        }
      />

      <Card
        title="Pending"
        badge={
          invitations && invitations.length > 0 ? (
            <Pill tone="warn">{invitations.length}</Pill>
          ) : undefined
        }
      >
        {error ? (
          <InlineError message={error.message} />
        ) : isLoading || !invitations ? (
          <LoadingRows rows={3} />
        ) : invitations.length === 0 ? (
          <InlineEmpty title="No pending invitations" hint="Everyone invited has accepted." />
        ) : (
          invitations.map((invite) => (
            <Row
              key={invite.id}
              title={invite.email}
              detail={`${invite.role.charAt(0)}${invite.role.slice(1).toLowerCase()} · sent ${invite.createdAt}${
                invite.invitedByName ? ` by ${invite.invitedByName}` : ""
              }`}
              right={
                <>
                  {/* Only when there is one. The membership row records no
                      expiry yet, and an empty pill is visual noise that reads
                      as a missing value rather than an absent concept. */}
                  {invite.expiresAt ? <Pill tone="nu">{invite.expiresAt}</Pill> : null}
                  {can("people.invite.member") ? (
                    <button
                      type="button"
                      className="zoiko-btn sm"
                      disabled={cancel.isPending}
                      onClick={() => setRevoking({ id: invite.id, email: invite.email })}
                    >
                      {cancel.isPending && cancel.variables === invite.id ? "Revoking…" : "Revoke"}
                    </button>
                  ) : null}
                </>
              }
            />
          ))
        )}
      </Card>

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          if (!revoking) return;
          cancel.mutate(revoking.id, { onSuccess: () => setRevoking(null) });
        }}
        title="Revoke this invitation?"
        message={
          revoking
            ? `${revoking.email} will no longer be able to join with the link they were sent. You can invite them again afterwards.`
            : ""
        }
        confirmLabel="Revoke invitation"
        loading={cancel.isPending}
      />

      {cancel.error ? (
        <Notice tone="warn">Could not revoke that invitation. {cancel.error.message}</Notice>
      ) : null}

      <Card title="How the token works" badge={<Pill tone="accent">Security</Pill>} padded>
        <ol className="space-y-2.5 text-[12px] text-[var(--ink2)]">
          <TokenStep>
            <b className="text-[var(--ink)]">32 random bytes</b>, shown once. Only a SHA-256 hash is
            stored, so a database dump yields no working invitations.
          </TokenStep>
          <TokenStep>
            <b className="text-[var(--ink)]">Bound to email, tenant and role</b> — all three.
            Forwarding the link to someone else fails.
          </TokenStep>
          <TokenStep>
            <b className="text-[var(--ink)]">Single use, 72-hour expiry</b>, revocable at any time.
          </TokenStep>
          <TokenStep>
            Privileged roles{" "}
            <b className="text-[var(--ink)]">must enrol MFA before the membership activates</b>
            <span className="font-mono-num ml-1.5 rounded bg-[var(--crit-soft)] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.06em] text-[var(--crit)]">
              Gate
            </span>
          </TokenStep>
          <TokenStep>
            The membership records <b className="text-[var(--ink)]">who granted it</b>, so every
            escalation has a name against it.
          </TokenStep>
        </ol>
      </Card>
    </>
  );
}

function TokenStep({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pl-5 leading-relaxed">
      <span
        aria-hidden
        className="absolute left-0 top-[6px] h-[7px] w-[7px] rounded-full border-2 border-[var(--accent)] bg-[var(--surface)]"
      />
      {children}
    </li>
  );
}
