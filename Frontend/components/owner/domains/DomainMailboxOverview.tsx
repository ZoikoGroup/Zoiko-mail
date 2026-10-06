"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Globe, Mail } from "lucide-react";
import { useDomainList } from "@/lib/domains-hooks";
import { useAdminMailboxes } from "@/lib/owner-hooks";
import { useSubscription } from "@/lib/billing-hooks";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { STATUS_LABEL, STATUS_TONE, PURPOSE_LABEL } from "@/components/domains/format";
import type { DomainDetail } from "@/lib/domains-api";
import type { Mailbox } from "@/lib/owner-api";

/**
 * Read-only Domain → Mailboxes presentation for the owner console.
 *
 * Purely additive: the domain cards above this own creation, DNS,
 * verification and every mutation. This panel only answers "which addresses
 * live on which domain, and under which plan" — two questions the existing
 * screens answer by cross-referencing two pages by hand.
 *
 * Mailboxes are matched to a domain by the address suffix, which is the same
 * string the mailboxes table already shows. Both queries are tenant-scoped on
 * the server (`GET /domains`, `GET /mail/admin/mailboxes`), so a row from
 * another workspace cannot appear here.
 */

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const VERIFY_LABEL: Record<DomainDetail["verificationStatus"], string> = {
  PENDING: "Awaiting DNS",
  VERIFIED: "Verified",
  FAILED: "Failed",
};

function dnsSummary(domain: DomainDetail): { label: string; variant: "ok" | "warn" | "nu" } {
  if (domain.readiness.fullyReady) return { label: "All checks pass", variant: "ok" };
  const blocking = domain.readiness.blocking ?? [];
  if (blocking.length > 0) {
    return {
      label: `Awaiting ${blocking.map((purpose) => PURPOSE_LABEL[purpose]).join(", ")}`,
      variant: "warn",
    };
  }
  return { label: "Not checked yet", variant: "nu" };
}

function MailboxRow({ mailbox }: { mailbox: Mailbox }) {
  const suspended = Boolean(mailbox.sendSuspendedAt);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2">
      <Mail className="h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs text-[var(--ink)]">{mailbox.address}</span>
        <span className="block truncate text-[11px] text-[var(--ink3)]">
          {mailbox.displayName} · created {formatDate(mailbox.createdAt)}
        </span>
      </span>
      <span className="font-mono-num text-[11px] text-[var(--ink3)]">
        {mailbox.storageUsedMb} / {mailbox.storageLimitMb} MB
      </span>
      <StatusBadge variant={suspended ? "crit" : "ok"}>{suspended ? "Sending suspended" : "Active"}</StatusBadge>
    </li>
  );
}

export function DomainMailboxOverview() {
  const { data: domains = [], isLoading: domainsLoading } = useDomainList();
  const { data: mailboxes = [], isLoading: mailboxesLoading } = useAdminMailboxes();
  const { data: sub } = useSubscription();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const planName = sub?.plan?.name ?? null;

  const sortedDomains = useMemo(
    () => [...domains].sort((a, b) => a.domainName.localeCompare(b.domainName)),
    [domains]
  );

  const mailboxIndex = useMemo(() => {
    const index = new Map<string, Mailbox[]>();
    for (const domain of sortedDomains) {
      index.set(
        domain.id,
        mailboxes.filter((m) => m.domain.toLowerCase() === domain.domainName.toLowerCase())
      );
    }
    return index;
  }, [sortedDomains, mailboxes]);

  // Addresses whose domain is not managed here (e.g. the registration domain
  // used when a mailbox was created without a verified domain). Shown once so
  // the counts on this page still account for every mailbox.
  const unmanaged = useMemo(() => {
    const managed = new Set(sortedDomains.map((d) => d.domainName.toLowerCase()));
    return mailboxes.filter((m) => !managed.has(m.domain.toLowerCase()));
  }, [sortedDomains, mailboxes]);

  const loading = domainsLoading || mailboxesLoading;
  if (!loading && sortedDomains.length === 0) return null;

  return (
    <div className="zoiko-card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink)]">Domains &amp; Mailboxes</h3>
          <p className="mt-0.5 text-[11px] text-[var(--ink3)]">
            Which addresses belong to which domain, and the plan the workspace is on.
            DNS and verification are managed on the domain cards above.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--s2)]">
              <th className="px-4 py-2.5 font-mono-num text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
                Domain
              </th>
              <th className="px-4 py-2.5 font-mono-num text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
                Status
              </th>
              <th className="hidden px-4 py-2.5 font-mono-num text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink3)] sm:table-cell">
                DNS
              </th>
              <th className="hidden px-4 py-2.5 font-mono-num text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink3)] sm:table-cell">
                Plan
              </th>
              <th className="px-4 py-2.5 font-mono-num text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
                Mailboxes
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-[var(--border)]">
                  <td className="px-4 py-3" colSpan={5}>
                    <Skeleton className="h-4 w-2/3" />
                  </td>
                </tr>
              ))
            ) : (
              sortedDomains.map((domain) => {
                const domainMailboxes = mailboxIndex.get(domain.id) ?? [];
                const dns = dnsSummary(domain);
                const expanded = expandedId === domain.id;
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
                          <Globe className="h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
                          <span className="font-mono text-xs font-medium text-[var(--ink)]">
                            {domain.domainName}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge variant={STATUS_TONE[domain.status]}>
                          {STATUS_LABEL[domain.status]}
                        </StatusBadge>
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <StatusBadge variant={dns.variant}>{dns.label}</StatusBadge>
                      </td>
                      <td className="hidden px-4 py-3 text-[var(--ink2)] sm:table-cell">
                        {planName ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono-num text-[var(--ink2)]">
                        {domainMailboxes.length}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-[var(--border)] bg-[var(--s2)]">
                        <td colSpan={5} className="px-4 py-4">
                          <div className="grid gap-3 sm:grid-cols-4">
                            <Fact label="Verification" value={VERIFY_LABEL[domain.verificationStatus]} />
                            <Fact label="DNS" value={dns.label} />
                            <Fact label="Plan" value={planName ?? "—"} />
                            <Fact
                              label="Mailboxes"
                              value={`${domainMailboxes.length} on this domain`}
                            />
                          </div>

                          <div className="mt-4 flex items-baseline justify-between">
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink3)]">
                              Mailboxes on {domain.domainName}
                            </h4>
                            <span className="text-[11px] text-[var(--ink3)]">
                              {domainMailboxes.length > 0 &&
                                `${domainMailboxes.filter((m) => m.sendSuspendedAt).length} sending-suspended`}
                            </span>
                          </div>

                          {domainMailboxes.length === 0 ? (
                            <p className="mt-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-xs text-[var(--ink3)]">
                              No mailboxes on this domain yet.{" "}
                              <Link href="/owner/mailboxes" className="text-[var(--accent-ink)] hover:underline">
                                Create one from the Mailboxes page
                              </Link>
                              .
                            </p>
                          ) : (
                            <ul className="mt-1 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2">
                              {domainMailboxes
                                .slice()
                                .sort((a, b) => a.address.localeCompare(b.address))
                                .map((mailbox) => (
                                  <MailboxRow key={mailbox.id} mailbox={mailbox} />
                                ))}
                            </ul>
                          )}

                          <p className="mt-3 text-[11px] leading-relaxed text-[var(--ink3)]">
                            A mailbox existing here means the address is provisioned in this
                            workspace. Sending from it still requires this domain to pass
                            ownership, SPF, DKIM and DMARC — the status above is the
                            authority on that, not the mailbox row.
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

      {unmanaged.length > 0 && (
        <div className="border-t border-[var(--border)] px-4 py-3 text-[11px] text-[var(--ink3)]">
          {unmanaged.length === 1
            ? "1 mailbox uses an address"
            : `${unmanaged.length} mailboxes use addresses`}{" "}
          on a domain that is not managed in Zoiko Mail and{" "}
          {unmanaged.length === 1 ? "is" : "are"} not listed above.
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--surface)] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink3)]">
        {label}
      </div>
      <div className="mt-0.5 truncate text-xs text-[var(--ink)]">{value}</div>
    </div>
  );
}
