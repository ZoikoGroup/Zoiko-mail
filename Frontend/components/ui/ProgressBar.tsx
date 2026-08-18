"use client";

interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showValue?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showValue = true,
  size = "sm",
  className = "",
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const height = size === "sm" ? "h-1.5" : "h-2.5";

  let color = "bg-[var(--accent)]";
  if (pct >= 90) color = "bg-[var(--crit)]";
  else if (pct >= 75) color = "bg-[var(--warn)]";

  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--ink3)]">
          {label && <span>{label}</span>}
          {showValue && (
            <span className="font-mono-num">
              {value.toLocaleString()} / {max.toLocaleString()}
            </span>
          )}
        </div>
      )}
      <div className={`${height} w-full overflow-hidden rounded-full bg-[var(--s3)]`}>
        <div
          className={`${height} rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
