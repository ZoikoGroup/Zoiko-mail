import { Ban } from 'lucide-react';
import { AuthCard, AuthHero } from '@/components/layout/AuthCard';
import { Button } from '@/components/ui/Button';
import { Note, Panel } from '@/components/ui/Card';

export const metadata = { title: 'Account suspended · Zoiko Mail' };

/**
 * STATE 10 · Account suspended
 * Feature 5 · Data Model §6.2 (AppUser.status = suspended) · Security §4.2
 *
 * Says plainly that data is retained and nothing is deleted — a user seeing
 * this screen assumes the worst otherwise. Also names who can fix it, because
 * Security §7.1 makes that a workspace decision rather than a Zoiko one, and
 * misdirecting them wastes a support cycle.
 */
export default function AccountSuspendedPage() {
  return (
    <AuthCard>
      <AuthHero
        tone="crit"
        icon={<Ban aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.7} />}
        title="Your account is suspended"
      >
        An administrator at Acme Corp suspended this account on 28 July.
      </AuthHero>

      <Panel label="What this means">
        <p className="m-0 text-xs2 leading-[1.6]">
          You cannot sign in or receive mail. Your data is retained — nothing has been deleted. Only a workspace Owner
          or Admin can restore access.
        </p>
      </Panel>

      <Button>Contact your administrator</Button>

      <Note>AppUser.status = suspended · sessions revoked immediately — Security §4.2 · Data Model §6.2.</Note>
    </AuthCard>
  );
}
