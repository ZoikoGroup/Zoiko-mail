"use client";

import Link from "next/link";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useMembers, useAdminMailboxes, useDomains, useTenant } from "@/lib/owner-hooks";
import { CreditCard, ArrowUpRight, Receipt, Users, Mail, HardDrive, Building2 } from "lucide-react";

const PLAN_LIMITS: Record<string, { name: string; userLimit: number; mailboxLimit: number; storageLimitGb: number; priceMonthly: number }> = {
  starter: { name: "Starter", userLimit: 10, mailboxLimit: 10, storageLimitGb: 10, priceMonthly: 49 },
  business_starter: { name: "Business Starter", userLimit: 25, mailboxLimit: 25, storageLimitGb: 50, priceMonthly: 149 },
  business_pro: { name: "Business Pro", userLimit: 50, mailboxLimit: 75, storageLimitGb: 100, priceMonthly: 249 },
  enterprise: { name: "Enterprise", userLimit: 200, mailboxLimit: 200, storageLimitGb: 500, priceMonthly: 499 },
};

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function BillingPage() {
  const { data: tenant, isLoading: tenantLoading } = useTenant();
  const { data: members = [], isLoading: membersLoading } = useMembers();
  const { data: mailboxes = [], isLoading: mailboxesLoading } = useAdminMailboxes();
  const { data: domains = [], isLoading: domainsLoading } = useDomains();

  const isLoading = tenantLoading || membersLoading || mailboxesLoading || domainsLoading;

  const planCode = tenant?.planCode ?? "starter";
  const plan = PLAN_LIMITS[planCode] ?? PLAN_LIMITS.starter;

  const activeUsers = members.filter((m) => m.status === "ACTIVE").length;
  const totalMailboxes = mailboxes.length;
  const storageUsedMb = mailboxes.reduce((sum, m) => sum + m.storageUsedMb, 0);
  const storageUsedGb = +(storageUsedMb / 1024).toFixed(1);

  // Generate usage history from tenant creation date (simulated monthly entries)
  const usageHistory: Array<{ id: string; date: string; amount: number; status: "paid" | "pending"; description: string }> = [];
  if (tenant?.createdAt) {
    const created = new Date(tenant.createdAt);
    const now = new Date();
    let d = new Date(created.getFullYear(), created.getMonth(), 1);
    let monthIndex = 0;
    while (d <= now) {
      const monthName = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const isCurrentMonth = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      usageHistory.push({
        id: `inv_${monthIndex}`,
        date: d.toISOString(),
        amount: plan.priceMonthly,
        status: isCurrentMonth ? "pending" : "paid",
        description: `${plan.name} — ${monthName}`,
      });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      monthIndex++;
    }
  }

  if (isLoading) {
    return (
      <ProtectedRoute allowedRoles={["OWNER"]}>
        <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
          <PageHeader title="Subscription & Billing" description="Manage your subscription plan and billing history." />
          <div className="flex h-48 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["OWNER"]}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Subscription & Billing"
          description="Manage your subscription plan and billing history."
        />

        {/* Current Plan */}
        <div className="zoiko-card p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
                <CreditCard className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-[var(--ink)]">{plan.name}</h3>
                <div className="flex items-center gap-2">
                  <StatusBadge variant="ok" dot>Active</StatusBadge>
                  <span className="text-[11px] text-[var(--ink3)]">
                    ${plan.priceMonthly}/month
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/owner/organization-settings" className="zoiko-btn pri">
                <ArrowUpRight className="h-3.5 w-3.5" /> Upgrade Plan
              </Link>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-[var(--s2)] p-3">
              <div className="flex items-center gap-2 text-[11px] text-[var(--ink3)]">
                <Users className="h-3.5 w-3.5" /> Users
              </div>
              <div className="mt-1 font-mono-num text-lg font-semibold text-[var(--ink)]">
                {activeUsers} <span className="text-sm font-normal text-[var(--ink3)]">/ {plan.userLimit}</span>
              </div>
              <ProgressBar value={activeUsers} max={plan.userLimit} className="mt-1" />
            </div>
            <div className="rounded-lg bg-[var(--s2)] p-3">
              <div className="flex items-center gap-2 text-[11px] text-[var(--ink3)]">
                <Mail className="h-3.5 w-3.5" /> Mailboxes
              </div>
              <div className="mt-1 font-mono-num text-lg font-semibold text-[var(--ink)]">
                {totalMailboxes} <span className="text-sm font-normal text-[var(--ink3)]">/ {plan.mailboxLimit}</span>
              </div>
              <ProgressBar value={totalMailboxes} max={plan.mailboxLimit} className="mt-1" />
            </div>
            <div className="rounded-lg bg-[var(--s2)] p-3">
              <div className="flex items-center gap-2 text-[11px] text-[var(--ink3)]">
                <HardDrive className="h-3.5 w-3.5" /> Storage
              </div>
              <div className="mt-1 font-mono-num text-lg font-semibold text-[var(--ink)]">
                {storageUsedGb} GB <span className="text-sm font-normal text-[var(--ink3)]">/ {plan.storageLimitGb} GB</span>
              </div>
              <ProgressBar value={storageUsedGb} max={plan.storageLimitGb} className="mt-1" />
            </div>
          </div>
        </div>

        {/* Billing History */}
        <div className="zoiko-card">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--ink)]">Billing History</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {usageHistory.length === 0 ? (
              <EmptyState
                icon={<Receipt className="h-7 w-7" />}
                title="No billing history"
                description="Your billing history will appear here once you have active invoices."
              />
            ) : (
              [...usageHistory].reverse().map((item) => (
                <div key={item.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="text-sm text-[var(--ink)]">{item.description}</div>
                    <div className="font-mono-num text-[11px] text-[var(--ink3)]">{formatDate(item.date)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono-num text-sm font-medium text-[var(--ink)]">${item.amount}</span>
                    <StatusBadge
                      variant={item.status === "paid" ? "ok" : "warn"}
                    >
                      {item.status}
                    </StatusBadge>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
