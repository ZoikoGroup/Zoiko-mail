'use client';

import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { AuthCard, AuthHero } from '@/components/layout/AuthCard';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Card';
import { useAuthStore } from '@/store/auth-store';
import { useSignInFlow } from '@/hooks/useSignInFlow';

/**
 * STATE 7 · No workspace available — DERIVED
 * Feature 3 consequence · Security §4.2
 *
 * The only state in this project not named in a document. It is a necessary
 * consequence of Security §4.2 requiring every request to resolve a tenant
 * context: with zero active memberships there is nothing to resolve, and
 * without this screen that is a blank page.
 *
 * Labelled as derived in the provenance strip so nobody mistakes it for a
 * requirement.
 */
export default function NoWorkspacePage() {
  const router = useRouter();
  const email = useAuthStore((s) => s.email);
  const { signOut, busy } = useSignInFlow();

  return (
    <AuthCard>
      <AuthHero
        tone="muted"
        icon={<Users aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.7} />}
        title="No workspace available"
      >
        You&rsquo;re authenticated, but you don&rsquo;t have an active membership.
      </AuthHero>

      <Panel label="What to do">
        <p className="m-0 text-xs2 leading-[1.6]">
          Ask a workspace Owner or Admin to invite <span className="font-mono">{email}</span>, or to restore your
          membership if it was removed.
        </p>
      </Panel>

      <div className="flex gap-2.5">
        <Button loading={busy('signout')} onClick={() => void signOut()}>
          Sign out
        </Button>
        <Button onClick={() => router.refresh()}>Check again</Button>
      </div>

      <Banner tone="warn">
        <b>Derived state.</b> Not named in the documents — a necessary consequence of Security §4.2 requiring a resolved
        tenant context. Without it, zero memberships is a blank screen.
      </Banner>
    </AuthCard>
  );
}
