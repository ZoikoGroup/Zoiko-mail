import type { ReactNode } from 'react';
import { LegalFooter } from './LegalFooter';
import { cn } from '@/utils/cn';

/**
 * The card column. Width is capped so running text stays comfortable;
 * "wide" is used only where a workspace list or a data table needs the
 * extra room.
 */
export function AuthCard({
  children,
  wide = false,
  footer = true,
}: {
  children: ReactNode;
  wide?: boolean;
  footer?: boolean;
}) {
  return (
    <div className={cn('mx-auto flex w-full animate-fade-rise flex-col gap-4', wide ? 'max-w-[412px]' : 'max-w-[376px]')}>
      {children}
      {footer && <LegalFooter />}
    </div>
  );
}

/** Heading block. One h1 per page keeps the document outline clean. */
export function AuthHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <h1 className="m-0 text-h3 font-semibold">{title}</h1>
      {children && <p className="mt-[7px] text-base2 leading-[1.55] text-ink-2">{children}</p>}
    </div>
  );
}

type HeroTone = 'ok' | 'warn' | 'crit' | 'muted' | 'accent';

const RINGS: Record<HeroTone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  crit: 'bg-crit-soft text-crit',
  muted: 'bg-s3 text-ink-3',
  accent: 'bg-accent-soft text-accent',
};

/** Centred outcome block used by the status and terminal states. */
export function AuthHero({
  tone,
  icon,
  title,
  children,
}: {
  tone: HeroTone;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="grid place-items-center gap-3 text-center">
      <span aria-hidden className={cn('grid h-[52px] w-[52px] place-items-center rounded-card', RINGS[tone])}>
        {icon}
      </span>
      <div>
        <h1 className="m-0 text-h3 font-semibold">{title}</h1>
        {children && <p className="mt-[7px] text-base2 leading-[1.55] text-ink-2">{children}</p>}
      </div>
    </div>
  );
}
