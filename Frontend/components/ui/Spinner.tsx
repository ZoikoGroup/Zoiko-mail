"use client";

import { Loader2 } from "lucide-react";

const SIZE = { xs: "h-3 w-3", sm: "h-3.5 w-3.5", md: "h-4 w-4", lg: "h-5 w-5" } as const;

/**
 * The small loading indicator: inside buttons, beside a single row, for "load
 * more" and for background refreshes. It never stands in for a page or pane
 * loading for the first time; that is BrandLoader (see its loading rules).
 *
 * With a `label`, the label shows beside it and the pair is announced as a
 * status. Without one, it is decorative: put it in a button whose own text
 * already says what is happening ("Sending…").
 */
export function Spinner({
  size = "md",
  label,
  className = "",
}: {
  size?: keyof typeof SIZE;
  label?: string;
  className?: string;
}) {
  const icon = <Loader2 className={`${SIZE[size]} shrink-0 animate-spin`} aria-hidden="true" />;
  if (!label) return <span className={`inline-flex text-current ${className}`}>{icon}</span>;
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-[var(--ink3)] ${className}`}>
      {icon}
      <span>{label}</span>
    </span>
  );
}

export default Spinner;
