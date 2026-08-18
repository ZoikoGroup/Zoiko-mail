"use client";

import Link from "next/link";
import { useDashboard } from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import {
  Card,
  ErrorState,
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
          <ErrorState message={error.message} />
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

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${data.tenant.name} · ${data.tenant.planCode} plan · ${data.tenant.region} region · tenant ${data.tenant.status}`}
        action={
          can("people.invite.member") ? (
            <Link href="/admin/invitations" className="zoiko-btn pri">
              Invite people
            </Link>
          ) : undefined
        }
      />

      <StaticNote>Mirrors GET /admin/dashboard — one aggregate call, not seven</StaticNote>

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
        <StatTile
          label="Mailboxes"
          value={c.mailboxes}
          suffix={`/${c.mailboxSeats}`}
          tone="ok"
          meter={pct(c.mailboxes, c.mailboxSeats)}
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
        <StatTile
          label="Failed sends"
          value={c.failedSends24h}
          sub="last 24 hours"
          tone={c.failedSends24h > 0 ? "crit" : undefined}
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
              <span className="zoiko-btn sm cursor-default opacity-60">View log · soon</span>
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
