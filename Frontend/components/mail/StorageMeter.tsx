"use client";

/**
 * "[USED] / [QUOTA] GB" bar shown at the bottom of the folder rail.
 * Pure presentational — the caller (FolderRail) supplies the numbers from
 * useMyMailbox(), including the loading state.
 */
export function StorageMeter({
  usedBytes,
  limitBytes,
  loading = false,
}: {
  usedBytes: number;
  limitBytes: number;
  loading?: boolean;
}) {
  const usedGb = usedBytes / 1024 / 1024 / 1024;
  const limitGb = limitBytes / 1024 / 1024 / 1024;
  const pct = limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0;
  // Amber past 80%, red past 95% — a quota that's about to block sending
  // deserves a different color before it actually blocks anything.
  const barColor =
    pct >= 95 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-[var(--accent)]";

  return (
    <div className="px-1 pt-3">
      <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-[var(--ink3)]">
        <span>Storage</span>
        <span className="font-mono-num normal-case tracking-normal">
          {loading ? "…" : `${usedGb.toFixed(1)} / ${limitGb.toFixed(0)} GB`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--s3)]">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: loading ? "0%" : `${pct}%` }}
        />
      </div>
    </div>
  );
}