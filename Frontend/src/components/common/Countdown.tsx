'use client';

import { useEffect } from 'react';
import { useCountdown } from '@/hooks/useCountdown';
import { cn } from '@/utils/cn';

/**
 * Presentational wrapper over useCountdown. aria-live is off deliberately:
 * announcing every second would be hostile to a screen-reader user, and
 * the surrounding copy already states what the timer is for.
 */
export function Countdown({
  seconds,
  onExpire,
  className,
}: {
  seconds: number;
  onExpire?: () => void;
  className?: string;
}) {
  const { label, expired } = useCountdown(seconds);

  useEffect(() => {
    if (expired) onExpire?.();
  }, [expired, onExpire]);

  return (
    <span role="timer" aria-live="off" className={cn('font-mono tnum', className)}>
      {label}
    </span>
  );
}
