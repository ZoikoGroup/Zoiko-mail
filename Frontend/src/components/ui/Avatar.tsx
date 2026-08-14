import { cn } from '@/utils/cn';

type Tone = 'accent' | 'ai' | 'warn' | 'crit' | 'muted' | 'ink';
type Size = 'sm' | 'md' | 'lg';

const TONES: Record<Tone, string> = {
  accent: 'bg-accent-soft text-accent-ink',
  ai: 'bg-ai-soft text-ai',
  warn: 'bg-warn-soft text-warn',
  crit: 'bg-crit-soft text-crit',
  muted: 'bg-s3 text-ink-3',
  ink: 'bg-ink text-surface',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 w-7 rounded-[8px] text-[12px]',
  md: 'h-9 w-9 rounded-[10px] text-[14px]',
  lg: 'h-[52px] w-[52px] rounded-card text-[18px]',
};

/** Square identity mark. Decorative — the adjacent text carries meaning. */
export function Avatar({
  children,
  tone = 'accent',
  size = 'md',
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  size?: Size;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center font-bold', TONES[tone], SIZES[size], className)}>
      {children}
    </span>
  );
}
