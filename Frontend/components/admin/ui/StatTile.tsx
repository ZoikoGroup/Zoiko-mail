/**
 * Admin workspace primitive. Composes the tokens and .zoiko-* classes that
 * already exist in app/globals.css rather than introducing a second styling
 * vocabulary.
 */

import type { Tone } from "./types";

/* ── stat tile ─────────────────────────────────────────────────────────── */

export function StatTile({
  label,
  value,
  suffix,
  sub,
  tone,
  meter,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  sub?: string;
  tone?: "ok" | "warn" | "crit" | "accent";
  /** 0–100. Encodes the same quantity as the number, in form. */
  meter?: number;
}) {
  const valueTone =
    tone === "ok" ? "text-[var(--ok)]"
    : tone === "warn" ? "text-[var(--warn)]"
    : tone === "crit" ? "text-[var(--crit)]"
    : tone === "accent" ? "text-[var(--accent)]"
    : "text-[var(--ink)]";

  const barTone =
    tone === "ok" ? "bg-[var(--ok)]"
    : tone === "warn" ? "bg-[var(--warn)]"
    : tone === "crit" ? "bg-[var(--crit)]"
    : "bg-[var(--accent)]";

  return (
    <div className="zoiko-stat">
      <div className="font-mono-num text-[9px] uppercase tracking-[0.11em] text-[var(--ink3)]">
        {label}
      </div>
      <div className={`font-mono-num mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.02em] ${valueTone}`}>
        {value}
        {suffix && <span className="text-[14px] text-[var(--ink3)]">{suffix}</span>}
      </div>
      {sub && <div className="mt-1 text-[10.8px] text-[var(--ink3)]">{sub}</div>}
      {meter !== undefined && (
        <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-[var(--s3)]">
          <div
            className={`h-full rounded-full ${barTone}`}
            style={{ width: `${Math.max(0, Math.min(100, meter))}%` }}
          />
        </div>
      )}
    </div>
  );
}
