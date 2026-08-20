"use client";

import {
  UserPlus,
  Mail,
  Globe,
  ShieldCheck,
  Link2,
  FileText,
  UserCheck,
  ShieldAlert,
} from "lucide-react";
import { useAuditEvents } from "@/lib/owner-hooks";

const actionIconMap: Record<string, { icon: typeof UserPlus; color: string }> = {
  "MEMBERSHIP_INVITATION_CREATED": { icon: UserPlus, color: "bg-[var(--accent-soft)] text-[var(--accent-ink)]" },
  "MEMBERSHIP_INVITATION_ACCEPTED": { icon: UserCheck, color: "bg-[var(--ok-soft)] text-[var(--ok)]" },
  "MEMBERSHIP_ADDED": { icon: UserPlus, color: "bg-[var(--ok-soft)] text-[var(--ok)]" },
  "MEMBERSHIP_ROLE_CHANGED": { icon: ShieldCheck, color: "bg-[var(--ai-soft)] text-[var(--ai)]" },
  "MEMBERSHIP_REMOVED": { icon: UserCheck, color: "bg-[var(--crit-soft)] text-[var(--crit)]" },
  "MAILBOX_CREATED": { icon: Mail, color: "bg-[var(--ok-soft)] text-[var(--ok)]" },
  "DOMAIN_VERIFICATION_PASSED": { icon: Globe, color: "bg-[var(--ok-soft)] text-[var(--ok)]" },
  "CONNECTED_ACCOUNT_CREATED": { icon: Link2, color: "bg-[var(--accent-soft)] text-[var(--accent-ink)]" },
  "POLICY_UPDATED": { icon: FileText, color: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  "MAIL_SENT": { icon: Mail, color: "bg-[var(--ok-soft)] text-[var(--ok)]" },
  "MAIL_DRAFT_CREATED": { icon: Mail, color: "bg-[var(--ok-soft)] text-[var(--ok)]" },
  "MAIL_DRAFT_DELETED": { icon: Mail, color: "bg-[var(--crit-soft)] text-[var(--crit)]" },
  "MAILBOX_SENDING_SUSPENDED": { icon: ShieldAlert, color: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  "MAILBOX_SENDING_RESUMED": { icon: ShieldCheck, color: "bg-[var(--ok-soft)] text-[var(--ok)]" },
};

function getIconForAction(action: string) {
  for (const [prefix, config] of Object.entries(actionIconMap)) {
    if (action.startsWith(prefix) || action === prefix) return config;
  }
  return { icon: ShieldCheck, color: "bg-[var(--s3)] text-[var(--ink3)]" };
}

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function RecentActivity() {
  const { data, isLoading } = useAuditEvents({ limit: 10 });
  const events = data?.events ?? [];

  return (
    <div className="zoiko-card">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Recent Activity</h2>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {isLoading && (
          <div className="px-4 py-8 text-center text-sm text-[var(--ink3)]">Loading…</div>
        )}
        {!isLoading && events.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[var(--ink3)]">No recent activity.</div>
        )}
        {events.map((event) => {
          const { icon: Icon, color } = getIconForAction(event.action);
          return (
            <div key={event.id} className="flex items-start gap-3 px-4 py-3">
              <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${color}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--ink2)]">
                  <span className="font-medium text-[var(--ink)]">{event.actorName}</span>
                  {" "}
                  <code className="rounded bg-[var(--s2)] px-1 py-0.5 font-mono text-[11px] text-[var(--ink3)]">{event.action}</code>
                </p>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--ink3)]">
                  <span>{event.targetName || event.targetType}</span>
                  <span>·</span>
                  <span>{timeAgo(event.createdAt)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
