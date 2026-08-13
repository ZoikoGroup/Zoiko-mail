'use client';

import { useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { AuthCard, AuthHero } from '@/components/layout/AuthCard';
import { Button } from '@/components/ui/Button';
import { Note, Panel } from '@/components/ui/Card';
import { trackAudit } from '@/services/telemetry';
import { useAuthStore } from '@/store/auth-store';
import { useSignInFlow } from '@/hooks/useSignInFlow';

/**
 * STATE 17 · Sessions revoked
 * Feature 8 · Security §4.2 · Audit §6.1
 *
 * Security §4.2: "User deletion, suspension and role changes must invalidate
 * affected sessions." The user-visible consequence is an ejection mid-session,
 * and without an explanation that reads as a crash. So the screen states the
 * cause and why it happens immediately rather than at next sign-in.
 */
export default function SessionsRevokedPage() {
  const clearSession = useAuthStore((s) => s.clearSession);
  const { signOut, busy } = useSignInFlow();

  useEffect(() => {
    trackAudit('session_revoked', { cause: 'role_changed' });
    trackAudit('role_changed', { from: 'owner', to: 'admin' });
    clearSession();
  }, [clearSession]);

  return (
    <AuthCard>
      <AuthHero
        tone="crit"
        icon={<ShieldCheck aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.7} />}
        title="You were signed out"
      >
        Your role at Acme Corp changed from Owner to Admin, so every session was revoked.
      </AuthHero>

      <Panel label="Why immediately, not at next sign-in">
        <p className="m-0 text-xs2 leading-[1.6]">
          A role change alters what you can reach. Rather than let a live session keep old permissions, all sessions are
          revoked and re-issued with the new role.
        </p>
      </Panel>

      <Button variant="primary" loading={busy('signout')} onClick={() => void signOut()}>
        Sign in again
      </Button>

      <Note>
        Security §4.2 —{' '}
        <i>&ldquo;user deletion, suspension and role changes must invalidate affected sessions.&rdquo;</i> Audit{' '}
        <span className="font-mono">session_revoked</span> · <span className="font-mono">role_changed</span>.
      </Note>
    </AuthCard>
  );
}
