'use client';

import { useCallback, useRef } from 'react';

/**
 * Six-digit code entry behaviour, extracted so the component stays
 * presentational.
 *
 * Auto-advance on entry, backspace steps back, arrow keys move, and a
 * pasted six-digit code fills every cell — which is how people actually
 * enter these, from a password manager or an SMS.
 */
export function useOtpField({
  value,
  onChange,
  onComplete,
  length = 6,
}: {
  value: string[];
  onChange: (index: number, digit: string) => void;
  onComplete?: (code: string) => void;
  length?: number;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const register = useCallback(
    (index: number) => (el: HTMLInputElement | null) => {
      refs.current[index] = el;
    },
    [],
  );

  const focusCell = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(length - 1, index));
      const el = refs.current[clamped];
      el?.focus();
      el?.select();
    },
    [length],
  );

  const maybeComplete = useCallback(
    (next: string[]) => {
      if (next.length === length && next.every((d) => d !== '')) onComplete?.(next.join(''));
    },
    [length, onComplete],
  );

  const handleChange = useCallback(
    (index: number, raw: string) => {
      const digits = raw.replace(/\D/g, '');

      // Pasted code: distribute across cells.
      if (digits.length > 1) {
        const next = [...value];
        for (let k = 0; k < digits.length && index + k < length; k += 1) next[index + k] = digits[k];
        next.forEach((digit, k) => onChange(k, digit));
        focusCell(index + digits.length);
        maybeComplete(next);
        return;
      }

      onChange(index, digits);

      if (digits) {
        const next = [...value];
        next[index] = digits;
        if (index < length - 1) focusCell(index + 1);
        maybeComplete(next);
      }
    },
    [value, onChange, focusCell, maybeComplete, length],
  );

  const handleKeyDown = useCallback(
    (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Backspace' && !value[index] && index > 0) {
        event.preventDefault();
        onChange(index - 1, '');
        focusCell(index - 1);
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        focusCell(index - 1);
      }
      if (event.key === 'ArrowRight' && index < length - 1) {
        event.preventDefault();
        focusCell(index + 1);
      }
    },
    [value, onChange, focusCell, length],
  );

  return { register, handleChange, handleKeyDown, focusCell };
}
