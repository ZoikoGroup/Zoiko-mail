import { Eye, ShieldCheck } from 'lucide-react';
import { BRAND_THESIS, PILOT_BADGES, TRUST_SIGNALS } from '@/constants/legal';

/** Source-traceability mark — no equivalent exists in the icon set. */
function TraceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <path d="M4 7h10M4 12h16M4 17h7" strokeLinecap="round" />
      <circle cx="18" cy="7" r="2.2" />
      <circle cx="14" cy="17" r="2.2" />
    </svg>
  );
}

const ICONS = {
  eye: Eye,
  trace: TraceIcon,
  shield: ShieldCheck,
} as const;

/**
 * The committed brand surface — deliberately identical in both themes.
 *
 * This panel is doing commercial work, not decoration. PRD §26 names
 * "customer distrust of mailbox access" as a High risk with a trust page as
 * the control, and Gate 3 requires ≥60% of invited pilot users to complete a
 * connection. The three trust signals answer that anxiety on the screen
 * where the user decides whether to proceed at all.
 */
export function BrandPanel() {
  return (
    <aside className="relative isolate flex flex-col gap-6 overflow-hidden bg-pnl px-8 py-9 text-pnl-ink lg:gap-7 lg:px-9 lg:py-10">
      <div aria-hidden className="panel-wash pointer-events-none absolute inset-0" />
      <div aria-hidden className="panel-grid pointer-events-none absolute inset-0" />

      <div className="relative flex items-center gap-[11px]">
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-pnl-ink text-[16px] font-extrabold text-pnl"
        >
          Z
        </span>
        <span>
          <span className="block text-[16.5px] font-semibold tracking-[-0.014em]">Zoiko Mail</span>
          <span className="block font-mono text-[9px] uppercase tracking-[0.15em] text-pnl-mut">Zoiko Tech Inc</span>
        </span>
      </div>

      <p className="relative m-0 max-w-[22ch] font-editorial text-[20px] leading-[1.24] tracking-[-0.013em] sm:text-thesis">
        {BRAND_THESIS}
      </p>

      <ul className="relative mt-auto flex list-none flex-col gap-[13px] p-0">
        {TRUST_SIGNALS.map(({ icon, title, body }) => {
          const Icon = ICONS[icon];
          return (
            <li key={title} className="flex items-start gap-[11px]">
              <Icon className="mt-px h-4 w-4 shrink-0 text-accent" />
              <span>
                <span className="block text-xs2 font-semibold text-pnl-ink">{title}</span>
                <span className="block text-[11.5px] leading-[1.5] text-pnl-mut">{body}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="relative flex flex-wrap items-center gap-[9px] border-t border-pnl-line pt-[15px]">
        {PILOT_BADGES.map((badge) => (
          <span
            key={badge}
            className="rounded-chip border border-pnl-line px-2 py-[3px] font-mono text-[9px] uppercase tracking-[0.1em] text-pnl-mut"
          >
            {badge}
          </span>
        ))}
      </div>
    </aside>
  );
}
