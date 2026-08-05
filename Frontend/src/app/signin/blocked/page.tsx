'use client';

import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { AuthCard, AuthHeading } from '@/components/layout/AuthCard';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Note, Panel } from '@/components/ui/Card';
import { ROUTES } from '@/constants/routes';

const AUTOMATIC_RESPONSE = ['Session refused', 'MFA forced on next attempt', 'Tenant admin alerted'] as const;

/**
 * STATE 15 · Sign-in blocked
 * Feature 7 · Security §5 risk signals · Runbook §6.4
 *
 * Runbook §6.4 prescribes the response: "disable session, require MFA reset,
 * alert tenant admin, escalate to Security if mailbox access likely." The
 * screen reports what already happened rather than asking the user to act
 * first — the automatic response is the control, and saying so is what makes
 * the alarm credible.
 */
export default function SignInBlockedPage() {
  const router = useRouter();

  return (
    <AuthCard>
      <AuthHeading title="We blocked an unusual sign-in">
        Someone tried to sign in from a device we don&rsquo;t recognise.
      </AuthHeading>

      <Banner tone="crit" live>
        <b>Lagos, Nigeria · 03:41 UTC</b>
        <span className="mt-1 block font-mono text-[10.5px] leading-[1.6] opacity-90">
          Chrome on Windows · 4,900 km from your last sign-in 12 minutes earlier
        </span>
      </Banner>

      <Panel label="Automatic response">
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {AUTOMATIC_RESPONSE.map((item) => (
            <li key={item} className="flex items-center gap-2 text-xs2">
              <Chip tone="ok" icon={<CheckCircle2 aria-hidden className="h-3 w-3" strokeWidth={2} />}>
                Done
              </Chip>
              {item}
            </li>
          ))}
        </ul>
      </Panel>

      <div className="flex gap-2.5">
        <Button variant="danger" onClick={() => router.push(ROUTES.revoked)}>
          Revoke all sessions
        </Button>
        <Button onClick={() => router.push(ROUTES.mfa)}>This was me</Button>
      </div>

      <Note>
        Security §5 risk signals · Runbook §6.4 —{' '}
        <i>&ldquo;disable session, require MFA reset, alert tenant admin.&rdquo;</i>
      </Note>
    </AuthCard>
  );
}
