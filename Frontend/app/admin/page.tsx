"use client";

import Link from "next/link";
import { useDashboard } from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import {
  Card,
  InlineError,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  Row,
  StatTile,
  StaticNote,
} from "@/components/admin/ui";

export default function AdminDashboardPage() {
  const can = useCan();
  const { data, isLoading, error } = useDashboard();

  if (error) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <InlineError message={error.message} />
        </Card>
      </>
    );
  }

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <LoadingRows rows={6} />
        </Card>
      </>
    );
  }

  const c = data.counts;
  const mfaGap = c.mfaTotal - c.mfaCovered;
  const pct = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);

  const failures = data.deliveryFailures;
  /**
   * "3 bounced, 1 rejected" rather than a bare total — a failed send is
   * actionable only once you know which kind it was. Zero-count types are
   * dropped so the line names what happened, not what didn't.
   */
  const failureBreakdown = failures
    ? Object.entries(failures.byType)
        .filter(([, count]) => count > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([type, count]) => `${count} ${type.toLowerCase().replace(/_/g, " ")}`)
        .join(" · ")
    : "";
  const failureWindowLabel = failures
    ? failures.windowHours === 24
      ? "last 24 hours"
      : `last ${failures.windowHours} hours`
    : "unavailable";

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${data.tenant.name} · ${data.tenant.planCode} plan · ${data.tenant.timezone} · tenant ${data.tenant.status}`}
        action={
          can("people.invite.member") ? (
            <Link href="/admin/invitations" className="zoiko-btn pri">
              Invite people
            </Link>
          ) : undefined
        }
      />

      {/*
        There is no GET /admin/dashboard. This note used to claim one, which
        made the page look like it had an endpoint nobody could find. The
        composition is deliberate — see useDashboard — so the note says what
        the page actually does.
      */}
      <StaticNote>
        Composed from the individual reads, so one failing subsystem cannot blank
        the page
      </StaticNote>

      {mfaGap > 0 && (
        <Notice tone="warn">
          <b className="text-[var(--warn)]">
            {mfaGap === 1 ? "One person has" : `${mfaGap} people have`} no second factor.
          </b>{" "}
          They can still sign in, which makes them the weakest point in the workspace. An Owner can
          require MFA for everyone — an Admin cannot set the security policy.
        </Notice>
      )}

      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(152px,1fr))] gap-2.5">
        <StatTile label="Users" value={c.people} sub={`${c.pendingInvitations} pending invites`} />
        {/*
          No meter and no "/seats" suffix. Seat entitlement is billing data an
          Admin cannot read, so the old denominator was the mailbox count
          itself — a bar that was always full and always meaningless.
        */}
        <StatTile
          label="Mailboxes"
          value={c.mailboxes}
          sub={
            c.suspendedMailboxes > 0
              ? `${c.suspendedMailboxes} suspended`
              : "none suspended"
          }
          tone={c.suspendedMailboxes > 0 ? "warn" : undefined}
        />
        <StatTile
          label="Connected"
          value={c.connectedAccounts}
          sub={`Gmail ${c.connectedGmail} · Microsoft ${c.connectedMicrosoft}`}
        />
        <StatTile
          label="Domains"
          value={`${c.domainsVerified}/${c.domainsTotal}`}
          sub="verified"
          tone="ok"
        />
        <StatTile
          label="MFA coverage"
          value={c.mfaCovered}
          suffix={`/${c.mfaTotal}`}
          tone="warn"
          meter={pct(c.mfaCovered, c.mfaTotal)}
        />
        {/*
          Real delivery failures, counted server-side. This tile used to show
          the number of suspended mailboxes under a "last 24 hours" label —
          a different quantity over a different period.
        */}
        <StatTile
          label="Failed sends"
          value={failures ? failures.failed : "—"}
          sub={failureBreakdown || failureWindowLabel}
          tone={failures && failures.failed > 0 ? "crit" : undefined}
        />
        <StatTile
          label="Storage"
          value={c.storageUsedGb}
          suffix=" GB"
          meter={pct(c.storageUsedGb, c.storageLimitGb)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card
          title="Recent audit events"
          action={
            can("audit.read") ? (
              // /admin/audit exists and reads GET /audit/events. This was a
              // disabled "soon" label sitting next to a working screen.
              <Link href="/admin/audit" className="zoiko-btn sm">
                View log
              </Link>
            ) : undefined
          }
        >
          {data.recentAudit.map((event) => (
            <Row
              key={event.id}
              title={event.eventType}
              detail={`${event.actorName} · ${event.targetLabel}`}
              right={
                <span className="font-mono-num text-[10.5px] text-[var(--ink3)]">
                  {event.createdAtLabel}
                </span>
              }
            />
          ))}
        </Card>

        <Card title="Provider sync">
          {data.providerSync.map((connector) => (
            <Row
              key={connector.id}
              title={connector.name}
              detail={connector.syncLabel}
              right={<Pill tone={connector.status === "ACTIVE" ? "ok" : "nu"}>
                {connector.status === "ACTIVE" ? "OK" : "Idle"}
              </Pill>}
            />
          ))}
        </Card>
      </div>
    </>
  );
}
