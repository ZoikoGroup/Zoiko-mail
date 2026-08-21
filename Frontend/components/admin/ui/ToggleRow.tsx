/**
 * Admin workspace primitive. Composes the tokens and .zoiko-* classes that
 * already exist in app/globals.css rather than introducing a second styling
 * vocabulary.
 */

/* ── toggle ────────────────────────────────────────────────────────────── */

/**
 * A locked toggle is either non-negotiable or outside this role's authority.
 * It renders disabled *and* the server refuses the write — the disabled control
 * is never the enforcement.
 */
export function ToggleRow({
  label,
  detail,
  enabled,
  locked,
  onToggle,
}: {
  label: string;
  detail: string;
  enabled: boolean;
  locked: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12.6px] font-semibold text-[var(--ink)]">{label}</div>
        <div className="text-[11px] text-[var(--ink3)]">{detail}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${label}${locked ? " (locked)" : ""}`}
        disabled={locked}
        onClick={onToggle}
        title={locked ? "Locked — non-negotiable or Owner-only" : undefined}
        className={`zoiko-toggle ${enabled ? "on" : ""} ${locked ? "lock" : ""}`}
      >
        <i />
      </button>
    </div>
  );
}
