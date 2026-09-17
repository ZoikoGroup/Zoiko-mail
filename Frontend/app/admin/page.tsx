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
  const pct = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);

  /**
   * Warn only about the people AC-002 actually compels.
   *
   * Two earlier versions of this line were wrong in opposite directions. The
   * first fired on every load of every workspace, when no second factor
   * existed to enrol in. The second counted everybody without one — which on
   * a workspace of fifteen with three privileged accounts reads as "fourteen
   * people are a risk", and sends an Admin chasing members the specification
   * deliberately leaves alone.
   *
   * The number that means compliance is the privileged one, and enforcement
   * is at sign-in, so a shortfall here means somebody was promoted and has
   * not signed in since.
   */
  const mfaGap = data.mfa.supported
    ? Math.max(0, data.mfa.requiredTotal - data.mfa.requiredCovered)
    : 0;

  const failures = data.deliveryFailures;
  /**
   * "3 bounced, 1 rejected" rather than a bare total — a failed send is
   * actionable only once you know which kind it was. Zero-count types are
   * dropped so the line names what happened, not what didn't.
   */
  const failureBreakdown = failures
    ? // `?? {}` rather than trusting the field. The mappers already reject a
      // body that is not a summary, but this is the line that throws if one
      // ever gets through, and an unhandled error here costs the whole page.
      Object.entries(failures.byType ?? {})
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

      <StaticNote>
        One read — GET /admin/dashboard — with each section resolved separately,
        so a failing subsystem costs one tile rather than the page
      </StaticNote>

      {/*
        A section the server could not read. Said out loud, because the tiles
        below it fall back to zero and a confident zero is indistinguishable
        from good news.
      */}
      {data.degraded.length > 0 && (
        <Notice tone="warn">
          <b className="text-[var(--warn)]">
            {data.degraded.length === 1
              ? "One section could not be read"
              : `${data.degraded.length} sections could not be read`}
            :
          </b>{" "}
          {data.degraded.join(", ")}. Those tiles show zero because the data is
          missing, not because the count is zero. The rest of this page is
          current.
        </Notice>
      )}

      {mfaGap > 0 && (
        <Notice tone="warn">
          <b className="text-[var(--warn)]">
            {mfaGap === 1
              ? "One privileged account has"
              : `${mfaGap} privileged accounts have`}{" "}
            no second factor.
          </b>{" "}
          Owners, Admins and Support must hold one, and they will be asked to enrol the next time
          they sign in — until then their sessions predate the requirement.
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
        {/*
          The headline counts the accounts AC-002 compels, not the whole
          workspace: this is a compliance figure, and it should read n of n on
          a healthy workspace however many members have declined. The wider
          number stays visible underneath, because "how much of the company
          uses MFA" is a fair question — it is just a different one.

          Amber only when the required number falls short. A green tile beside
          an unenrolled Admin would be the same lie in a quieter voice.
        */}
        <StatTile
          label="MFA coverage"
          value={data.mfa.supported ? data.mfa.requiredCovered : "—"}
          suffix={data.mfa.supported ? `/${data.mfa.requiredTotal}` : undefined}
          sub={
            data.mfa.supported
              ? `required · ${data.mfa.covered}/${data.mfa.total} workspace-wide`
              : "not available yet"
          }
          tone={data.mfa.supported ? (mfaGap > 0 ? "warn" : "ok") : undefined}
          meter={
            data.mfa.supported
              ? pct(data.mfa.requiredCovered, data.mfa.requiredTotal)
              : undefined
          }
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
