'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { AuthCard, AuthHeading } from '@/components/layout/AuthCard';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Note, Panel } from '@/components/ui/Card';
import { ROUTES } from '@/constants/routes';
import { trackFunnel } from '@/services/telemetry';

/**
 * STATE 11 · Invitation pending
 * Feature 5 · Data Model §6.2–6.3 · QA §8 "accept invite"
 *
 * Detected at sign-in when AppUser.status and Membership.status are both
 * `invited`, and routed into acceptance rather than failing. A user who never
 * finished setup is not an error case — they are mid-flow.
 */
export default function InvitationPendingPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    trackFunnel('invitation_viewed');
  }, []);

  const accept = () => {
    setBusy(true);
    trackFunnel('invitation_accepted');
    setTimeout(() => router.push(ROUTES.mfa), 280);
  };

  return (
    <AuthCard>
      <AuthHeading title="Finish setting up your account">
        You were invited to Acme Corp but haven&rsquo;t accepted yet.
      </AuthHeading>

      <Panel>
        <div className="flex items-center gap-3">
          <Avatar tone="accent">A</Avatar>
          <span>
            <span className="block text-base2 font-semibold">Acme Corp</span>
            <span className="block font-mono text-[10.5px] text-ink-3">invited as Member · 24 members</span>
          </span>
        </div>
      </Panel>

      <Button variant="primary" loading={busy} onClick={accept}>
        Continue to invitation
        <ArrowRight aria-hidden className="h-3.5 w-3.5" strokeWidth={1.9} />
      </Button>

      <Note>
        AppUser.status = invited · Membership.status = invited. Detected at sign-in and routed to acceptance rather than
        failing — Data Model §6.2–6.3 · QA §8.
      </Note>
    </AuthCard>
  );
}
