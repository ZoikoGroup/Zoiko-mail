'use client';

import { useEffect, useState } from 'react';
import { formatDuration } from '@/utils/format';

/**
 * A real countdown, not a static figure. The account-lock state depends on
 * it — Runbook §6.4 treats account lock as a state support must be able to
 * explain, and the user needs to know when they can try again.
 */
export function useCountdown(seconds: number) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
  }, [seconds]);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  return {
    remaining,
    label: formatDuration(remaining),
    expired: remaining <= 0,
  };
}
