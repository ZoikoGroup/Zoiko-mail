/**
 * Admin workspace primitive. Composes the tokens and .zoiko-* classes that
 * already exist in app/globals.css rather than introducing a second styling
 * vocabulary.
 */

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
