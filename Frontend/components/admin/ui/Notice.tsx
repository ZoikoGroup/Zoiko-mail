/**
 * Admin workspace primitive. Composes the tokens and .zoiko-* classes that
 * already exist in app/globals.css rather than introducing a second styling
 * vocabulary.
 */

import type { ReactNode } from "react";

/* ── notice ────────────────────────────────────────────────────────────── */

const NOTICE_TONE: Record<"info" | "ok" | "warn" | "crit", string> = {
  info: "bg-[var(--ai-soft)] border-[var(--ai)]",
  ok: "bg-[var(--ok-soft)] border-[var(--ok)]",
  warn: "bg-[var(--warn-soft)] border-[var(--warn)]",
  crit: "bg-[var(--crit-soft)] border-[var(--crit)]",
};

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "ok" | "warn" | "crit";
  children: ReactNode;
}) {
  return (
    <div
      className={`mb-4 rounded-[10px] border px-3.5 py-3 text-[12px] leading-relaxed text-[var(--ink2)] ${NOTICE_TONE[tone]}`}
    >
      {children}
    </div>
  );
}
