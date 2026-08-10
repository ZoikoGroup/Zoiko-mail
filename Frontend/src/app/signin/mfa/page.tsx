'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AuthCard, AuthHeading } from '@/components/layout/AuthCard';
import { Banner } from '@/components/common/Banner';
import { StepIndicator } from '@/components/common/StepIndicator';
import { OtpField } from '@/components/forms/OtpField';
import { Button } from '@/components/ui/Button';
import { ROUTES } from '@/constants/routes';
import { useSignInFlow } from '@/hooks/useSignInFlow';
import { useAuthStore } from '@/store/auth-store';
import { trackFunnel } from '@/services/telemetry';

/**
 * STATE 4 · MFA challenge
 * Feature 2 · PRD §17.1, §23.2 · Security §5
 *
 * Mandatory for Owner, Admin and Support; recommended for Members. The code
 * field auto-advances, accepts a pasted code, and raises the numeric keypad
 * on mobile.
 */
export default function MfaPage() {
  const otp = useAuthStore((s) => s.otp);
  const setOtpDigit = useAuthStore((s) => s.setOtpDigit);
  const complete = useAuthStore((s) => s.otpComplete());
  const { verifyMfa, busy } = useSignInFlow();

  useEffect(() => {
    trackFunnel('mfa_viewed');
  }, []);

  const submit = () => void verifyMfa(otp.join(''));

  return (
    <AuthCard>
      <StepIndicator current={3} />

      <AuthHeading title="Two-factor authentication">
        Enter the 6-digit code from your authenticator app.
      </AuthHeading>

      <OtpField value={otp} onChange={setOtpDigit} onComplete={() => submit()} />

      <Button variant="primary" disabled={!complete} loading={busy('mfa')} onClick={submit}>
        Verify
      </Button>

      <div className="flex flex-col gap-1.5">
        <Link href={ROUTES.recovery} className="text-xs2 font-semibold text-accent no-underline hover:underline">
          Use a recovery code
        </Link>
        <Link href={ROUTES.mfa} className="text-xs2 font-semibold text-accent no-underline hover:underline">
          Send to my registered device
        </Link>
      </div>

      <Banner tone="info">Mandatory for Owner, Admin and Support. Recommended for Members — Security §5.</Banner>
    </AuthCard>
  );
}
