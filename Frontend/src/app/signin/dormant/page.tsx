'use client';

import { useRouter } from 'next/navigation';
import { Hourglass } from 'lucide-react';
import { AuthCard, AuthHero } from '@/components/layout/AuthCard';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { DetailList, Note, Panel } from '@/components/ui/Card';
import { ROUTES } from '@/constants/routes';

/**
 * STATE 18 · Dormant privileged review
 * Feature 10 · Security §5
 *
 * Security §5 requires that "inactive privileged accounts must be reviewed and
 * disabled according to operational policy" but never defines the policy. It is
 * stated here: 90 days for privileged roles, enforced by a scheduled evaluator.
 *
 * The scheduled job is the actual security control — it disables the account
 * before it can be exploited. This screen exists so a legitimate returning
 * user gets an explanation rather than a bare failure.
 *
 * Why it matters concretely: a forgotten Admin can create a forwarding rule
 * that silently redirects mail to an external address. Security §7.1 permits
 * it, Audit §13 logs it, and nobody reads audit logs for an account they have
 * forgotten exists.
 */
const POLICY_ROWS = [
  { label: 'Threshold for privileged roles', value: '90 days' },
  { label: 'Your last sign-in', value: '1 May · 94 days' },
  { label: 'Disabled by', value: 'scheduled evaluator' },
] as const;

export default function DormantAccountPage() {
  const router = useRouter();

  return (
    <AuthCard wide>
      <AuthHero
        tone="warn"
        icon={<Hourglass aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.7} />}
        title="This account needs review"
      >
        You haven&rsquo;t signed in for 94 days, and this account holds privileged access.
      </AuthHero>

      <Panel label="Operational policy — now stated">
        <DetailList
          rows={[...POLICY_ROWS, { label: 'Role held', value: <Chip tone="accent">Admin</Chip> }]}
        />
      </Panel>

      <Banner tone="warn">
        <b>Why this exists.</b> A forgotten Admin account can create forwarding rules that silently redirect mail. The
        scheduled job disables the account before that can happen; this screen exists so a legitimate returning user
        gets an explanation rather than a bare failure.
      </Banner>

      <div className="flex gap-2.5">
        <Button variant="primary" onClick={() => router.push(ROUTES.signIn)}>
          Request review from an Owner
        </Button>
        <Button onClick={() => router.push(ROUTES.signIn)}>Sign out</Button>
      </div>

      <Note>
        Security §5 —{' '}
        <i>&ldquo;inactive privileged accounts must be reviewed and disabled according to operational policy.&rdquo;</i>
      </Note>
    </AuthCard>
  );
}
