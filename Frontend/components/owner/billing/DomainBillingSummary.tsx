"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { useDomainList } from "@/lib/domains-hooks";
import { useAdminMailboxes } from "@/lib/owner-hooks";
import { useSubscription } from "@/lib/billing-hooks";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Subscription } from "@/lib/billing-api";

/** The badge variants this file can produce; mirrors `StatusBadge`'s union. */
type BadgeVariant = "ok" | "warn" | "crit" | "nu" | "accent";

/**
 * Domain-level subscription summary on the owner billing page.
 *
 * The backend holds exactly one subscription per workspace
 * (`subscriptions.tenantId`, no `domainId`, no plan fields on `mail_domains`),
 * so this table reports the workspace plan against each domain rather than
 * inventing per-domain plans, dates or limits. Nothing here is hardcoded: plan
 * name and limits come from `GET /billing/subscription`, mailbox counts from
 * `GET /mail/admin/mailboxes`, domains from `GET /domains`. Fields the API
 * does not expose — a plan start date — render as "Not available" instead of
 * a plausible-looking guess.
 */

const EXPIRING_SOON_DAYS = 30;

type BillingState = { label: string; variant: BadgeVariant };

function deriveBillingState(sub: Subscription | null | undefined): BillingState {
  const hasSubscription = Boolean(sub?.id && sub.status);
  if (!hasSubscription || !sub) return { label: "No subscription", variant: "nu" };

  const status = sub.status ?? "";
  const expiry = sub.trialEnd ?? sub.currentPeriodEnd;
  const days = expiry ? Math.ceil((Date.parse(expiry) - Date.now()) / 86_400_000) : null;

  if (days !== null && days < 0) return { label: "Expired", variant: "crit" };
  if (status === "unpaid" || status === "incomplete_expired")
    return { label: "Suspended", variant: "crit" };
  if (status === "past_due" || status === "incomplete")
    return { label: "Past due", variant: "warn" };
  if (status === "canceled") return { label: "Cancelled", variant: "nu" };
  if (days !== null && days <= EXPIRING_SOON_DAYS)
    return { label: "Expiring Soon", variant: "warn" };
  if (status === "active" || status === "trialing" || status === "paid")
    return { label: "Active", variant: "ok" };
  return { label: status || "Unknown", variant: "nu" };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function daysRemainingOf(sub: Subscription | null | undefined): number | null {
  if (!sub?.id || !sub.status) return null;
  const expiry = sub.trialEnd ?? sub.currentPeriodEnd;
  if (!expiry) return null;
  return Math.ceil((Date.parse(expiry) - Date.now()) / 86_400_000);
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-[var(--s2)] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink3)]">
        {label}
      </div>
      <div className="mt-0.5 truncate text-xs text-[var(--ink)]">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[10px] text-[var(--ink3)]">{hint}</div>}
    </div>
  );
}

export function DomainBillingSummary() {
  const { data: domains = [], isLoading: domainsLoading } = useDomainList();
  const { data: mailboxes = [], isLoading: mailboxesLoading } = useAdminMailboxes();
  const { data: sub, isLoading: subLoading } = useSubscription();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const plan = sub?.plan ?? null;
  const hasSubscription = Boolean(sub?.id && sub.status);
  const state = deriveBillingState(sub);
  const daysRemaining = daysRemainingOf(sub);
  const expiryIso = sub?.trialEnd ?? sub?.currentPeriodEnd ?? null;

  const workspaceMailboxCount = mailboxes.length;
  const remainingCapacity =
    plan && plan.mailboxLimit >= workspaceMailboxCount
      ? plan.mailboxLimit - workspaceMailboxCount
      : null;

  const sortedDomains = useMemo(
    () => [...domains].sort((a, b) => a.domainName.localeCompare(b.domainName)),
    [domains]
  );

  const countsByDomain = useMemo(() => {
    const index = new Map<string, number>();
    for (const domain of sortedDomains) {
      const key = domain.domainName.toLowerCase();
      index.set(
        domain.id,
        mailboxes.filter((m) => m.domain.toLowerCase() === key).length
      );
    }
    return index;
  }, [sortedDomains, mailboxes]);

  const loading = domainsLoading || mailboxesLoading || subLoading;

  return (
    <div className="zoiko-card overflow-hidden">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--ink)]">Subscriptions by domain</h3>
        <p className="mt-0.5 text-[11px] text-[var(--ink3)]">
          Select a domain for its billing detail.
        </p>
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-[var(--s2)] px-3 py-2 text-[11px] leading-relaxed text-[var(--ink3)]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Plans, limits and renewal dates are held at the <strong>workspace</strong> level —
            the backend has no per-domain subscription yet, so every domain is shown under the
            one workspace plan. Nothing on this card is estimated: fields the API does not
            expose are marked “Not available”.
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--s2)]">
              {["Domain", "Plan", "Status", "Mailboxes", "Expiry", "Days Remaining"].map(
                (label) => (
                  <th
                    key={label}
                    className="px-4 py-2.5 font-mono-num text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink3)]"
                  >
                    {label}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-[var(--border)]">
                  <td className="px-4 py-3" colSpan={6}>
                    <Skeleton className="h-4 w-2/3" />
                  </td>
                </tr>
              ))
            ) : sortedDomains.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--ink3)]">
                  No domains yet. Add a domain to see it here.
                </td>
              </tr>
            ) : (
              sortedDomains.map((domain) => {
                const expanded = expandedId === domain.id;
                const domainCount = countsByDomain.get(domain.id) ?? 0;
                return (
                  <Fragment key={domain.id}>
                    <tr
                      className="zoi-fade cursor-pointer border-b border-[var(--border)] transition hover:bg-[var(--s2)]"
                      onClick={() => setExpandedId(expanded ? null : domain.id)}
                    >
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2">
                          {expanded ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
                          )}
                          <span className="font-mono text-xs font-medium text-[var(--ink)]">
                            {domain.domainName}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--ink2)]">
                        {hasSubscription && plan ? plan.name : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge variant={state.variant}>{state.label}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 font-mono-num text-[var(--ink2)]">
                        {domainCount}
                      </td>
                      <td className="px-4 py-3 text-[var(--ink2)]">{formatDate(expiryIso)}</td>
                      <td className="px-4 py-3 font-mono-num text-[var(--ink2)]">
                        {daysRemaining === null
                          ? "—"
                          : daysRemaining < 0
                            ? `${Math.abs(daysRemaining)} ago`
                            : daysRemaining}
                      </td>
                    </tr>

                    {expanded && (
                      <tr className="border-b border-[var(--border)] bg-[var(--s2)]">
                        <td colSpan={6} className="px-4 py-4">
                          <div className="mb-3 text-xs font-semibold text-[var(--ink)]">
                            {domain.domainName}
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                            <Fact
                              label="Plan"
                              value={hasSubscription && plan ? plan.name : "No subscription"}
                              hint="Workspace plan"
                            />
                            <Fact
                              label="Plan status"
                              value={sub?.status ?? "—"}
                              hint={sub?.cancelAtPeriodEnd ? "Will not renew" : undefined}
                            />
                            <Fact label="Billing status" value={state.label} />
                            <Fact label="Plan start" value="Not available" hint="Not exposed by the billing API" />
                            <Fact label="Expires / renews" value={formatDate(expiryIso)} />
                            <Fact
                              label="Days remaining"
                              value={
                                daysRemaining === null
                                  ? "—"
                                  : daysRemaining < 0
                                    ? `Expired ${Math.abs(daysRemaining)} days ago`
                                    : `${daysRemaining} days`
                              }
                            />
                            <Fact
                              label="Mailboxes on this domain"
                              value={String(domainCount)}
                            />
                            <Fact
                              label="Mailbox usage (workspace)"
                              value={
                                plan
                                  ? `${workspaceMailboxCount} / ${plan.mailboxLimit}`
                                  : `${workspaceMailboxCount} used`
                              }
                              hint={
                                plan
                                  ? `${
                                      remainingCapacity ?? 0
                                    } remaining under ${plan.name}`
                                  : "Plan limit unknown"
                              }
                            />
                            <Fact
                              label="Mailbox limit"
                              value={plan ? String(plan.mailboxLimit) : "Not available"}
                              hint="Workspace-wide"
                            />
                            <Fact
                              label="Storage limit"
                              value={plan ? `${plan.storageLimitGb} GB` : "Not available"}
                              hint="Workspace-wide"
                            />
                          </div>

                          <p className="mt-3 text-[11px] leading-relaxed text-[var(--ink3)]">
                            The limit and the counter above are workspace-wide: the backend
                            counts mailboxes across the whole workspace when it enforces the
                            plan, not per domain. Domain-level plans, start dates and renewal
                            dates need a subscription row scoped to a domain, which does not
                            exist yet.
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
