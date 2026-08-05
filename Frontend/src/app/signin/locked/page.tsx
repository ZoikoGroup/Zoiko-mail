'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { AuthCard, AuthHero } from '@/components/layout/AuthCard';
import { Banner } from '@/components/common/Banner';
import { Countdown } from '@/components/common/Countdown';
import { Button } from '@/components/ui/Button';
import { Note, Panel } from '@/components/ui/Card';
import { ROUTES } from '@/constants/routes';

/** 14 minutes 52 seconds, matching the design. */
const LOCK_SECONDS = 892;

/**
 * STATE 9 · Account locked
 * Feature 9 · Runbook §6.4
 *
 * Runbook §6.4 lists "account lock" among the states support must be able to
 * verify when a user cannot sign in. The countdown is real, and when it
 * reaches zero the retry path unlocks — a static figure leaves the user
 * guessing.
 *
 * The message is identical whether or not the account exists.
 */
export default function AccountLockedPage() {
  const router = useRouter();
  const [expired, setExpired] = useState(false);

  const onExpire = useCallback(() => setExpired(true), []);

  return (
    <AuthCard>
      <AuthHero
        tone="warn"
        icon={<Lock aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.7} />}
        title="Too many attempts"
      >
        Sign-in is temporarily locked for this account.
      </AuthHero>

      <Panel>
        <div className="grid place-items-center gap-1.5 py-2">
          {expired ? (
            <>
              <span className="font-mono text-[22px] font-semibold text-ok">Ready</span>
              <span className="font-mono text-[10.5px] text-ink-3">you can try again now</span>
            </>
          ) : (
            <>
              <Countdown
                seconds={LOCK_SECONDS}
                onExpire={onExpire}
                className="text-[34px] font-semibold tracking-[-0.025em]"
              />
              <span className="font-mono text-[10.5px] text-ink-3">until you can try again</span>
            </>
          )}
        </div>
      </Panel>

      {expired ? (
        <Button variant="primary" onClick={() => router.push(ROUTES.signIn)}>
          Try signing in again
        </Button>
      ) : (
        <Button onClick={() => router.push(ROUTES.recovery)}>Recover your account instead</Button>
      )}

      <Banner tone="ai">
        Shown identically whether or not the account exists — a lock message must not confirm a valid email.
      </Banner>

      <Note>Runbook §6.4 lists account lock among the states support must verify.</Note>
    </AuthCard>
  );
}
