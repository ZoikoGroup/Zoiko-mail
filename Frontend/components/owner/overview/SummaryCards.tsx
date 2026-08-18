"use client";

import { Users, UserCheck, Mail, Globe, Link2, UserPlus, HardDrive, ShieldAlert } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { mockSummaryStats } from "@/lib/owner-mock-data";

export function SummaryCards() {
  const s = mockSummaryStats;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Total Users" value={s.totalUsers} icon={Users} />
      <StatCard label="Active Users" value={s.activeUsers} icon={UserCheck} />
      <StatCard label="Total Mailboxes" value={s.totalMailboxes} icon={Mail} />
      <StatCard label="Active Domains" value={s.activeDomains} icon={Globe} />
      <StatCard label="Connected Accounts" value={s.connectedAccounts} icon={Link2} />
      <StatCard label="Pending Invitations" value={s.pendingInvitations} icon={UserPlus} />
      <div className="zoiko-stat">
        <div className="flex items-center justify-between">
          <div className="font-mono-num text-[10px] font-medium uppercase tracking-wider text-[var(--ink3)]">
            Storage Usage
          </div>
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent-ink)]">
            <HardDrive className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-1 text-xl font-semibold text-[var(--ink)]">
          {s.storageUsedGb} GB
        </div>
        <ProgressBar
          value={s.storageUsedGb}
          max={s.storageLimitGb}
          showValue
          className="mt-2"
        />
      </div>
      <StatCard label="Security Alerts" value={s.securityAlerts} icon={ShieldAlert} />
    </div>
  );
}
