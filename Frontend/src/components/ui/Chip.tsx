import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export type ChipTone = 'ok' | 'warn' | 'crit' | 'accent' | 'ai' | 'muted';

const TONES: Record<ChipTone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  crit: 'bg-crit-soft text-crit',
  accent: 'bg-accent-soft text-accent-ink',
  ai: 'bg-ai-soft text-ai',
  muted: 'bg-s3 text-ink-3',
};

/**
 * Status is never colour alone — every chip carries an icon or a word.
 * That satisfies WCAG 2.2 AA and survives the screenshot someone pastes
 * into a support ticket.
 */
export function Chip({
  tone = 'muted',
  icon,
  children,
  className,
}: {
  tone?: ChipTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-chip px-[7px] py-[2.5px]',
        'font-mono text-[9.5px] font-bold uppercase tracking-[0.06em] whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
