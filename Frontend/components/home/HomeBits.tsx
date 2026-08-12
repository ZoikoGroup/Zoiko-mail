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
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-semibold text-white">
      {initialsFrom(name, email)}
    </span>
  );
}

// Map each role to a zoiko-pill tone.
const ROLE_TONE: Record<string, string> = {
  OWNER: "ai",
  ADMIN: "accent",
  MEMBER: "nu",
  SUPPORT: "warn",
};

export function RoleBadge({ role }: { role: string }) {
  const tone = ROLE_TONE[role] ?? "nu";
  return <span className={`zoiko-pill ${tone}`}>{role}</span>;
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
    <div className="zoiko-card p-5">
      <div className="font-mono-num text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-[var(--ink)]">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-[var(--ink3)]">{hint}</div>}
    </div>
  );
}