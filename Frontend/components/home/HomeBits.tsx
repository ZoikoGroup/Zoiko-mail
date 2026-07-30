"use client";

import { ReactNode } from "react";

export function initialsFrom(name?: string, email?: string): string {
  const base = (name?.trim() || email || "?").trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export function Avatar({ name, email }: { name?: string; email?: string }) {
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-sm font-semibold text-white">
      {initialsFrom(name, email)}
    </span>
  );
}

const ROLE_STYLES: Record<string, string> = {
  OWNER: "bg-violet-50 text-violet-700 ring-violet-600/20",
  ADMIN: "bg-sky-50 text-sky-700 ring-sky-600/20",
  MEMBER: "bg-slate-100 text-slate-600 ring-slate-500/20",
  SUPPORT: "bg-amber-50 text-amber-700 ring-amber-600/20",
};

export function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_STYLES[role] ?? ROLE_STYLES.MEMBER;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {role}
    </span>
  );
}

export function InfoCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}