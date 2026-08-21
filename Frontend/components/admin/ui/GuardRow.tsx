/**
 * Admin workspace primitive. Composes the tokens and .zoiko-* classes that
 * already exist in app/globals.css rather than introducing a second styling
 * vocabulary.
 */

/* ── guardrail ─────────────────────────────────────────────────────────── */

export function GuardRow({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-b border-l-[3px] border-[var(--border)] border-l-[var(--crit)] px-4 py-3 last:border-b-0">
      <div className="mb-0.5 text-[12.5px] font-semibold text-[var(--ink)]">{title}</div>
      <div className="text-[11.8px] leading-relaxed text-[var(--ink2)]">{detail}</div>
    </div>
  );
}
