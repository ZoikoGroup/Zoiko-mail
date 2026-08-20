"use client";

import { Users, UserCheck, Mail, Globe, Link2, UserPlus, HardDrive } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton } from "@/components/ui/Skeleton";
import { useMembers, useAdminMailboxes, useDomains, useConnectors } from "@/lib/owner-hooks";

export function SummaryCards() {
  const { data: members, isLoading: membersLoading } = useMembers();
  const { data: mailboxes, isLoading: mailboxesLoading } = useAdminMailboxes();
  const { data: domains, isLoading: domainsLoading } = useDomains();
  const { data: connectors, isLoading: connectorsLoading } = useConnectors();

  const isLoading = membersLoading || mailboxesLoading || domainsLoading || connectorsLoading;

  const membersList = members ?? [];
  const mailboxesList = mailboxes ?? [];
  const domainsList = domains ?? [];
  const connectorsList = connectors ?? [];

  const totalUsers = membersList.length;
  const activeUsers = membersList.filter((m) => m.status === "ACTIVE").length;
  const pendingInvitations = membersList.filter((m) => m.status === "INVITED").length;
  const activeDomains = domainsList.filter((d) => d.isActive).length;
  const connectedAccounts = connectorsList.length;
  const totalMailboxes = mailboxesList.length;
  const storageUsedMb = mailboxesList.reduce((sum, m) => sum + m.storageUsedMb, 0);
  const storageLimitMb = mailboxesList.reduce((sum, m) => sum + m.storageLimitMb, 0);
  const storageUsedGb = +(storageUsedMb / 1024).toFixed(1);
  const storageLimitGb = Math.round(storageLimitMb / 1024);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="zoiko-stat space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </div>
    );
  }

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
      <StatCard
        label="Unhealthy Connectors"
        value={connectorsList.filter((c) => c.status !== "ACTIVE").length}
        icon={Link2}
      />
    </div>
  );
}
