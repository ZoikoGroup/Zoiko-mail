/**
 * Admin workspace primitives.
 *
 * Deliberately thin: the design tokens and `.zoiko-card` / `.zoiko-pill` /
 * `.zoiko-btn` / `.zoiko-toggle` classes already exist in `app/globals.css`, so
 * these components compose what is there rather than introducing a second
 * styling vocabulary. Only the meter and table needed new CSS.
 */
import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "crit" | "ai" | "nu" | "accent";

/* ── page header ───────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="min-w-0">
        <h1 className="font-editorial text-[25px] font-normal leading-tight tracking-[-0.016em] text-[var(--ink)]">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-[var(--ink3)]">{subtitle}</p>}
      </div>
      {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
    </div>
  );
}

/* ── pill ──────────────────────────────────────────────────────────────── */

export function Pill({ tone = "nu", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`zoiko-pill ${tone}`}>{children}</span>;
}

/* ── card ──────────────────────────────────────────────────────────────── */

export function Card({
  title,
  badge,
  action,
  padded = false,
  children,
}: {
  title?: string;
  badge?: ReactNode;
  action?: ReactNode;
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="zoiko-card mb-4">
      {(title || badge || action) && (
        <header className="flex flex-wrap items-center gap-2.5 border-b border-[var(--border)] px-4 py-3">
          {title && <h2 className="text-[13.5px] font-semibold text-[var(--ink)]">{title}</h2>}
          {badge}
          {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={padded ? "px-4 py-4" : ""}>{children}</div>
    </section>
  );
}

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

/* ── row (label / detail / right-hand meta) ────────────────────────────── */

export function Row({
  title,
  detail,
  right,
}: {
  title: ReactNode;
  detail?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12.6px] font-semibold text-[var(--ink)]">{title}</div>
        {detail && <div className="text-[11px] text-[var(--ink3)]">{detail}</div>}
      </div>
      {right && <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/* ── table ─────────────────────────────────────────────────────────────── */

/** Wraps the table so wide content scrolls itself and never the page body. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return <table className="w-full min-w-[560px] border-collapse">{children}</table>;
}

export function Th({ children, srOnly }: { children: ReactNode; srOnly?: boolean }) {
  return (
    <th className="font-mono-num whitespace-nowrap border-b border-[var(--border)] bg-[var(--s2)] px-4 py-2.5 text-left text-[9px] font-normal uppercase tracking-[0.11em] text-[var(--ink3)]">
      {srOnly ? <span className="sr-only">{children}</span> : children}
    </th>
  );
}

export function Td({
  children,
  mono,
  muted,
  nowrap,
}: {
  children: ReactNode;
  mono?: boolean;
  muted?: boolean;
  nowrap?: boolean;
}) {
  return (
    <td
      className={[
        "border-b border-[var(--border)] px-4 py-2.5 align-middle text-[12.4px]",
        mono ? "font-mono-num" : "",
        muted ? "text-[var(--ink3)]" : "text-[var(--ink2)]",
        nowrap ? "whitespace-nowrap" : "",
      ].join(" ")}
    >
      {children}
    </td>
  );
}

/* ── empty state ───────────────────────────────────────────────────────── */

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-10 text-center text-[var(--ink3)]">
      <div aria-hidden className="mb-2 text-2xl">
        ◇
      </div>
      <div className="font-semibold text-[var(--ink)]">{title}</div>
      {hint && <div className="mt-1 text-[12px]">{hint}</div>}
    </div>
  );
}

/* ── loading / error ───────────────────────────────────────────────────── */

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3.5 last:border-b-0">
          <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--s3)]" />
          <div className="ml-auto h-3 w-16 animate-pulse rounded bg-[var(--s3)]" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="px-4 py-8 text-center">
      <div className="text-[13px] font-semibold text-[var(--crit)]">Could not load this</div>
      <p className="mx-auto mt-1 max-w-[46ch] text-[12px] text-[var(--ink3)]">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="zoiko-btn sm mt-3">
          Try again
        </button>
      )}
    </div>
  );
}

/* ── static-data marker ────────────────────────────────────────────────── */

/**
 * Flags a screen still reading fixtures, with a note on what the real data
 * depends on. Removed per screen as `lib/admin/hooks.ts` is wired up.
 */
export function StaticNote({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono-num mb-3.5 flex items-center gap-2 rounded-lg border border-dashed border-[var(--bstrong)] px-3 py-2 text-[11px] text-[var(--ink3)]">
      <span className="font-bold text-[var(--accent-ink)]">STATIC</span>
      <span>{children}</span>
    </div>
  );
}
