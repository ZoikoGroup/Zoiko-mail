"use client";

import { useInvitations } from "@/lib/admin/hooks";
import { useCan } from "@/lib/admin/capabilities";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  Pill,
  Row,
} from "@/components/admin/ui";

export default function AdminInvitationsPage() {
  const can = useCan();
  const { data: invitations, isLoading, error } = useInvitations();

  // The role ceiling is the whole point of this screen: an Admin may grant
  // Member and nothing above it. Rendered from capabilities so widening the
  // grant later is a server-side data change, not a UI edit.
  const grantable = [
    can("people.invite.member") && "Member",
    can("people.invite.admin") && "Admin",
    can("people.invite.owner") && "Owner",
  ].filter(Boolean) as string[];

  return (
    <>
      <PageHeader
        title="Invitations"
        subtitle="Membership is granted, never claimed. Registering creates an account with no access."
        action={
          can("people.invite.member") ? (
            <button type="button" className="zoiko-btn pri">
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
          <ErrorState message={error.message} />
        ) : isLoading || !invitations ? (
          <LoadingRows rows={3} />
        ) : invitations.length === 0 ? (
          <EmptyState title="No pending invitations" hint="Everyone invited has accepted." />
        ) : (
          invitations.map((invite) => {
            const expiringSoon = invite.expiresAt.toLowerCase().includes("tomorrow");
            return (
              <Row
                key={invite.id}
                title={invite.email}
                detail={`${invite.role.charAt(0)}${invite.role.slice(1).toLowerCase()} · sent ${invite.createdAt}${
                  invite.invitedByName ? ` by ${invite.invitedByName}` : ""
                }`}
                right={
                  <>
                    <Pill tone={expiringSoon ? "warn" : "nu"}>{invite.expiresAt}</Pill>
                    <button type="button" className="zoiko-btn sm">
                      {expiringSoon ? "Resend" : "Revoke"}
                    </button>
                  </>
                }
              />
            );
          })
        )}
      </Card>

      <Card title="Issue an invitation" padded>
        <div className="mb-3 max-w-[440px]">
          <label
            htmlFor="invite-email"
            className="font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
          >
            Email address
          </label>
          <input
            id="invite-email"
            type="email"
            placeholder="name@acme.test"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)] placeholder:text-[var(--ink3)]"
          />
        </div>

        <div className="mb-3 max-w-[440px]">
          <label
            htmlFor="invite-role"
            className="font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
          >
            Role
          </label>
          <select
            id="invite-role"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)]"
          >
            {grantable.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
          {!can("people.invite.admin") && (
            <p className="mt-1.5 text-[11.5px] text-[var(--ink3)]">
              Member only — Admins cannot grant Admin or Owner.
            </p>
          )}
        </div>

        <button type="button" className="zoiko-btn pri sm">
          Send invitation
        </button>
      </Card>

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
