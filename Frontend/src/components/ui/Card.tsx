import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

/** Inset panel for session detail, timelines and policy figures. */
export function Panel({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-field border border-border bg-s2 px-3 py-[11px]', className)}>
      {label && <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">{label}</span>}
      {children}
    </div>
  );
}

/** Monospaced provenance note that closes most screens. */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('m-0 font-mono text-[10px] leading-[1.72] text-ink-3', className)}>{children}</p>;
}

/** Hairline divider. */
export function Divider({ className }: { className?: string }) {
  return <div aria-hidden className={cn('h-px bg-border', className)} />;
}

/** Label/value rows used by timelines and policy tables. */
export function DetailList({ rows }: { rows: ReadonlyArray<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="m-0 flex flex-col gap-1.5">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-baseline justify-between gap-3">
          <dt className="text-xs2 text-ink-2">{label}</dt>
          <dd className="m-0 font-mono text-[11.5px] text-ink-2 tnum">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
