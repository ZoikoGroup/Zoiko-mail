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
import { mockRecentActivity, type ActivityItem } from "@/lib/owner-mock-data";

const iconMap: Record<ActivityItem["type"], { icon: typeof UserPlus; color: string }> = {
  user_invited: { icon: UserPlus, color: "bg-[var(--accent-soft)] text-[var(--accent-ink)]" },
  mailbox_created: { icon: Mail, color: "bg-[var(--ok-soft)] text-[var(--ok)]" },
  domain_verified: { icon: Globe, color: "bg-[var(--ok-soft)] text-[var(--ok)]" },
  role_changed: { icon: ShieldCheck, color: "bg-[var(--ai-soft)] text-[var(--ai)]" },
  connected_account_added: { icon: Link2, color: "bg-[var(--accent-soft)] text-[var(--accent-ink)]" },
  policy_updated: { icon: FileText, color: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  user_joined: { icon: UserCheck, color: "bg-[var(--ok-soft)] text-[var(--ok)]" },
  security_event: { icon: ShieldAlert, color: "bg-[var(--crit-soft)] text-[var(--crit)]" },
};

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
  return (
    <div className="zoiko-card">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Recent Activity</h2>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {mockRecentActivity.map((item) => {
          const { icon: Icon, color } = iconMap[item.type];
          return (
            <div key={item.id} className="flex items-start gap-3 px-4 py-3">
              <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${color}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--ink2)]">{item.description}</p>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--ink3)]">
                  <span>{item.actor}</span>
                  <span>·</span>
                  <span>{timeAgo(item.timestamp)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
