"use client";

import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { mockSubscription, mockBillingHistory } from "@/lib/owner-mock-data";
import { CreditCard, ArrowUpRight, Receipt, Users, Mail, HardDrive } from "lucide-react";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function BillingPage() {
  const sub = mockSubscription;

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
                <h3 className="text-base font-semibold text-[var(--ink)]">{sub.name}</h3>
                <div className="flex items-center gap-2">
                  <StatusBadge variant="ok" dot>Active</StatusBadge>
                  <span className="text-[11px] text-[var(--ink3)]">
                    Renews {formatDate(sub.renewalDate)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="zoiko-btn">
                <Receipt className="h-3.5 w-3.5" /> Billing History
              </button>
              <button className="zoiko-btn pri">
                <ArrowUpRight className="h-3.5 w-3.5" /> Upgrade Plan
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-[var(--s2)] p-3">
              <div className="flex items-center gap-2 text-[11px] text-[var(--ink3)]">
                <Users className="h-3.5 w-3.5" /> Users
              </div>
              <div className="mt-1 font-mono-num text-lg font-semibold text-[var(--ink)]">
                {sub.activeUsers} <span className="text-sm font-normal text-[var(--ink3)]">/ {sub.userLimit}</span>
              </div>
            </div>
            <div className="rounded-lg bg-[var(--s2)] p-3">
              <div className="flex items-center gap-2 text-[11px] text-[var(--ink3)]">
                <Mail className="h-3.5 w-3.5" /> Mailboxes
              </div>
              <div className="mt-1 font-mono-num text-lg font-semibold text-[var(--ink)]">
                {sub.mailboxesUsed} <span className="text-sm font-normal text-[var(--ink3)]">/ {sub.mailboxLimit}</span>
              </div>
            </div>
            <div className="rounded-lg bg-[var(--s2)] p-3">
              <div className="flex items-center gap-2 text-[11px] text-[var(--ink3)]">
                <HardDrive className="h-3.5 w-3.5" /> Storage
              </div>
              <div className="mt-1 font-mono-num text-lg font-semibold text-[var(--ink)]">
                {sub.storageUsedGb} GB <span className="text-sm font-normal text-[var(--ink3)]">/ {sub.storageLimitGb} GB</span>
              </div>
              <ProgressBar value={sub.storageUsedGb} max={sub.storageLimitGb} className="mt-1" />
            </div>
          </div>
        </div>

        {/* Billing History */}
        <div className="zoiko-card">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--ink)]">Billing History</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {mockBillingHistory.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm text-[var(--ink)]">{item.description}</div>
                  <div className="font-mono-num text-[11px] text-[var(--ink3)]">{formatDate(item.date)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono-num text-sm font-medium text-[var(--ink)]">${item.amount}</span>
                  <StatusBadge
                    variant={item.status === "paid" ? "ok" : item.status === "pending" ? "warn" : "crit"}
                  >
                    {item.status}
                  </StatusBadge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
