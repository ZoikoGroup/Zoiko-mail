'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Mail, Users } from 'lucide-react';
import { AuthCard, AuthHeading } from '@/components/layout/AuthCard';
import { Banner } from '@/components/common/Banner';
import { OptionCard } from '@/components/forms/OptionCard';
import { Button } from '@/components/ui/Button';
import { Note } from '@/components/ui/Card';
import { ROUTES } from '@/constants/routes';
import { useAuthStore } from '@/store/auth-store';
import { maskEmail } from '@/utils/format';

/**
 * Recovery entry point.
 *
 * Not one of the eighteen states: Security §5 places recovery with the identity
 * provider, so this page is the hand-off the login page links to rather than a
 * flow Zoiko Mail owns. It exists because "Can't sign in?" must lead somewhere
 * real.
 *
 * The anti-phishing line is deliberate. Zoiko Mail is an email product, so its
 * own credential surface is a high-value phishing target, and Security §5
 * forbids support bypassing MFA without a Security-Admin approved exception.
 */
export default function RecoveryPage() {
  const router = useRouter();
  const email = useAuthStore((s) => s.email);
  const [selected, setSelected] = useState(0);

  const options = [
    { icon: Mail, title: 'Email a recovery link', detail: `to ${maskEmail(email)}` },
    { icon: KeyRound, title: 'Use a recovery code', detail: 'from your saved set of ten' },
    { icon: Users, title: 'Ask a workspace Owner', detail: 'approval-based recovery' },
  ] as const;

  return (
    <AuthCard>
      <AuthHeading title="Recover your account">
        Recovery is handled by ZoikoID and is fully audited. Support cannot bypass it for you.
      </AuthHeading>

      <div className="flex flex-col gap-2.5">
        {options.map((option, i) => (
          <OptionCard
            key={option.title}
            icon={option.icon}
            title={option.title}
            detail={option.detail}
            selected={selected === i}
            onSelect={() => setSelected(i)}
          />
        ))}
      </div>

      <Button variant="primary" onClick={() => router.push(ROUTES.signIn)}>
        Continue
      </Button>

      <Banner tone="crit">
        Zoiko support <b>cannot</b> bypass MFA without a Security-Admin approved exception. Anyone offering to is not
        from Zoiko.
      </Banner>

      <Note>Security §5 · Runbook §6.4 — recovery is auditable and approval-gated.</Note>
    </AuthCard>
  );
}
