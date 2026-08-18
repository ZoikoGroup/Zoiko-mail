"use client";

import Link from "next/link";
import { UserPlus, Mail, Globe, Link2, FileText } from "lucide-react";

const actions = [
  { label: "Invite User", href: "/owner/users", icon: UserPlus, color: "bg-[var(--accent-soft)] text-[var(--accent-ink)]" },
  { label: "Create Mailbox", href: "/owner/mailboxes", icon: Mail, color: "bg-[var(--ok-soft)] text-[var(--ok)]" },
  { label: "Add Domain", href: "/owner/domains", icon: Globe, color: "bg-[var(--ai-soft)] text-[var(--ai)]" },
  { label: "Connect Account", href: "/owner/connected-accounts", icon: Link2, color: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  { label: "View Audit Logs", href: "/owner/audit-logs", icon: FileText, color: "bg-[var(--s3)] text-[var(--ink3)]" },
];

export function QuickActions() {
  return (
    <div>
      <h2 className="mb-3 font-mono-num text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
        Quick Actions
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.href}
              href={a.href}
              className="flex items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm font-medium text-[var(--ink2)] shadow-[var(--sh1)] transition hover:border-[var(--accent)] hover:shadow-[var(--sh2)]"
            >
              <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${a.color}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              {a.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
