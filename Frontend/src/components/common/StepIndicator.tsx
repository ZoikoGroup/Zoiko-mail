import { cn } from '@/utils/cn';

const STEPS = ['Email', 'ZoikoID', 'MFA', 'Workspace'] as const;

export type StepNumber = 1 | 2 | 3 | 4;

/**
 * Four-step progress across the sign-in sequence. The current step is
 * announced with aria-current so position is never communicated by colour
 * alone.
 */
export function StepIndicator({ current }: { current: StepNumber }) {
  return (
    <ol className="flex flex-wrap items-center" aria-label="Sign-in progress">
      {STEPS.map((label, i) => {
        const n = (i + 1) as StepNumber;
        const done = n < current;
        const now = n === current;

        return (
          <li key={label} className="flex items-center" aria-current={now ? 'step' : undefined}>
            <span
              aria-hidden
              className={cn(
                'block h-2 w-2 shrink-0 rounded-full',
                done ? 'bg-ok' : now ? 'bg-accent shadow-focus' : 'bg-bstrong',
              )}
            />
            <span
              className={cn(
                'ml-[7px] font-mono text-[9px] uppercase tracking-[0.09em]',
                now ? 'font-bold text-ink' : 'text-ink-3',
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <span aria-hidden className="mx-2 h-px w-[18px] bg-bstrong" />}
          </li>
        );
      })}
    </ol>
  );
}
