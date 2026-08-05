import type { ReactNode } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Info, ShieldCheck } from 'lucide-react';
import { cn } from '@/utils/cn';

export type BannerTone = 'info' | 'warn' | 'crit' | 'ok' | 'ai';

const TONES: Record<BannerTone, { cls: string; Icon: typeof Info }> = {
  info: { cls: 'bg-accent-soft text-accent-ink', Icon: Info },
  warn: { cls: 'bg-warn-soft text-warn', Icon: AlertTriangle },
  crit: { cls: 'bg-crit-soft text-crit', Icon: Ban },
  ok: { cls: 'bg-ok-soft text-ok', Icon: CheckCircle2 },
  ai: { cls: 'bg-ai-soft text-ai', Icon: ShieldCheck },
};

/**
 * Errors are announced politely and can receive focus, so a screen-reader
 * user learns the cause without hunting for it.
 */
export function Banner({
  tone = 'info',
  children,
  live = false,
  className,
}: {
  tone?: BannerTone;
  children: ReactNode;
  live?: boolean;
  className?: string;
}) {
  const { cls, Icon } = TONES[tone];
  const isAlert = tone === 'crit' || tone === 'warn';

  return (
    <div
      role={isAlert ? 'alert' : undefined}
      aria-live={live ? 'polite' : undefined}
      className={cn('flex items-start gap-[9px] rounded-field px-[13px] py-[11px] text-xs2 leading-[1.48]', cls, className)}
    >
      <Icon aria-hidden className="mt-px h-4 w-4 shrink-0" strokeWidth={1.7} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
