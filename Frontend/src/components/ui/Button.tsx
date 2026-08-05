'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/utils/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent border-accent text-accent-on shadow-e1 hover:brightness-[1.06] active:brightness-95',
  secondary: 'bg-surface border-bstrong text-ink hover:bg-s2',
  ghost: 'bg-transparent border-transparent text-ink-2 hover:bg-s2 hover:text-ink',
  danger: 'bg-transparent border-crit text-crit hover:bg-crit-soft',
};

const SIZES: Record<Size, string> = {
  md: 'text-base2 px-4 py-[11px]',
  sm: 'text-xs2 px-3 py-2',
};

/**
 * One primary button per screen. Loading replaces the label rather than
 * disabling silently, so the control never looks broken mid-request.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', full = true, loading = false, children, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-field border font-semibold',
        'transition-[background-color,filter,border-color] duration-150 ease-premium',
        'disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        full ? 'w-full' : 'w-auto',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <>
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
          <span>Working&hellip;</span>
        </>
      ) : (
        children
      )}
    </button>
  );
});
