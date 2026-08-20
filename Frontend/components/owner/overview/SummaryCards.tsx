"use client";

import { Users, UserCheck, Mail, Globe, Link2, UserPlus, HardDrive, ShieldAlert } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useMembers, useAdminMailboxes, useDomains, useConnectors } from "@/lib/owner-hooks";

export function SummaryCards() {
  const { data: members = [] } = useMembers();
  const { data: mailboxes = [] } = useAdminMailboxes();
  const { data: domains = [] } = useDomains();
  const { data: connectors = [] } = useConnectors();

  const totalUsers = members.length;
  const activeUsers = members.filter((m) => m.status === "ACTIVE").length;
  const pendingInvitations = members.filter((m) => m.status === "INVITED").length;
  const activeDomains = domains.filter((d) => d.isActive).length;
  const connectedAccounts = connectors.length;
  const totalMailboxes = mailboxes.length;
  const storageUsedMb = mailboxes.reduce((sum, m) => sum + m.storageUsedMb, 0);
  const storageLimitMb = mailboxes.reduce((sum, m) => sum + m.storageLimitMb, 0);
  const storageUsedGb = +(storageUsedMb / 1024).toFixed(1);
  const storageLimitGb = Math.round(storageLimitMb / 1024);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Total Users" value={totalUsers} icon={Users} />
      <StatCard label="Active Users" value={activeUsers} icon={UserCheck} />
      <StatCard label="Total Mailboxes" value={totalMailboxes} icon={Mail} />
      <StatCard label="Active Domains" value={activeDomains} icon={Globe} />
      <StatCard label="Connected Accounts" value={connectedAccounts} icon={Link2} />
      <StatCard label="Pending Invitations" value={pendingInvitations} icon={UserPlus} />
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
          {storageUsedGb} GB
        </div>
        <ProgressBar
          value={storageUsedMb}
          max={storageLimitMb || 1}
          showValue
          className="mt-2"
        />
      </div>
      <StatCard label="Security Alerts" value={0} icon={ShieldAlert} />
    </div>
  );
}
