/**
 * Admin workspace primitive. Composes the tokens and .zoiko-* classes that
 * already exist in app/globals.css rather than introducing a second styling
 * vocabulary.
 */

import type { ReactNode } from "react";

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
