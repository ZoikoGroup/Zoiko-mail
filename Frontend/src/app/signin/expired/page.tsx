'use client';

import { RefreshCw } from 'lucide-react';
import { AuthCard, AuthHero } from '@/components/layout/AuthCard';
import { Button } from '@/components/ui/Button';
import { Note, Panel } from '@/components/ui/Card';
import { useSignInFlow } from '@/hooks/useSignInFlow';

/**
 * STATE 16 · Session expired
 * Feature 8 · QA §12 · Security §6
 *
 * QA §12 names "expired session" as a required security test case. Security §6
 * requires privileged sessions to time out sooner than Member sessions, so the
 * copy says which timeout fired rather than a generic "please sign in" —
 * otherwise an Owner reads it as a bug.
 *
 * Also covers invalid or malformed token, per the same QA clause.
 */
export default function SessionExpiredPage() {
  const { signOut, busy } = useSignInFlow();

  return (
    <AuthCard>
      <AuthHero
        tone="muted"
        icon={<RefreshCw aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.7} />}
        title="Your session expired"
      >
        You were inactive for 30 minutes. As an Owner, your session times out sooner than a Member&rsquo;s.
      </AuthHero>

      <Panel label="Nothing was lost">
        <p className="m-0 text-xs2 leading-[1.6]">
          Your draft to <b>client@meridian.co.uk</b> was saved. You&rsquo;ll return to it after signing in.
        </p>
      </Panel>

      <Button variant="primary" loading={busy('signout')} onClick={() => void signOut()}>
        Sign in again
      </Button>

      <Note>
        Security §6 finite lifetime and shorter privileged idle timeout. Also covers invalid or malformed token —
        QA §12.
      </Note>
    </AuthCard>
  );
}
