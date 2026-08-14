'use client';

import { useOtpField } from '@/hooks/useOtpField';
import { cn } from '@/utils/cn';

/**
 * Six-digit code entry.
 *
 * inputMode="numeric" raises the numeric keypad on mobile and
 * autoComplete="one-time-code" lets the OS offer the code from SMS or an
 * authenticator. Behaviour lives in useOtpField so this stays presentational.
 */
export function OtpField({
  value,
  onChange,
  onComplete,
  invalid = false,
  label = 'Verification code',
}: {
  value: string[];
  onChange: (index: number, digit: string) => void;
  onComplete?: (code: string) => void;
  invalid?: boolean;
  label?: string;
}) {
  const { register, handleChange, handleKeyDown } = useOtpField({ value, onChange, onComplete });

  return (
    <div role="group" aria-label={label} className="flex gap-[9px]">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={register(i)}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.currentTarget.select()}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          aria-label={`Digit ${i + 1} of 6`}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-[54px] flex-1 rounded-tile border bg-s2 text-center font-mono text-[22px] text-ink tnum',
            'outline-none transition-shadow duration-150',
            invalid
              ? 'border-crit shadow-focus-crit'
              : 'border-bstrong focus:border-accent focus:bg-surface focus:shadow-focus',
          )}
        />
      ))}
    </div>
  );
}
