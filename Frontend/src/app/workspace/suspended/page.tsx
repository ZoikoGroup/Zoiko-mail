'use client';

import { AlertTriangle } from 'lucide-react';
import { AuthCard, AuthHero } from '@/components/layout/AuthCard';
import { Banner } from '@/components/common/Banner';
import { WorkspaceOption } from '@/components/forms/WorkspaceOption';
import { Button } from '@/components/ui/Button';
import { Note } from '@/components/ui/Card';
import { useSignInFlow } from '@/hooks/useSignInFlow';
import { useAuthStore } from '@/store/auth-store';

/**
 * STATE 13 · Workspace suspended
 * Feature 6 · Data Model §6.1 (Tenant.status = suspended) · Security §7.2
 *
 * Tenant status is evaluated at step 3 of the ten-step permission order,
 * before role — so this blocks an Owner exactly as it blocks a Member. The copy
 * separates account health from workspace health, because a user reading this
 * needs to know their own account is fine.
 */
export default function WorkspaceSuspendedPage() {
  const workspaces = useAuthStore((s) => s.workspaces);
  const { chooseWorkspace, busy } = useSignInFlow();

  const suspended = { ...workspaces[0], tone: 'warn' as const };
  const available = workspaces[1];

  return (
    <AuthCard wide>
      <AuthHero
        tone="warn"
        icon={<AlertTriangle aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.7} />}
        title={`${suspended.name} is suspended`}
      >
        Your account is fine — the workspace itself is restricted.
      </AuthHero>

      <Banner tone="warn">
        Sending has been restricted under acceptable-use controls. An Owner can review the case and appeal.
      </Banner>

      <div className="flex flex-col gap-2.5">
        <WorkspaceOption workspace={suspended} caption="Suspended · unavailable" unavailable />
        <WorkspaceOption
          workspace={available}
          caption="Member · active"
          selected
          onSelect={() => void chooseWorkspace(available.id)}
        />
      </div>

      <Button variant="primary" loading={busy('workspace')} onClick={() => void chooseWorkspace(available.id)}>
        Continue to {available.name}
      </Button>

      <Note>
        Tenant.status = suspended · evaluated at step 3 of the ten-step order, before role — Security §7.2.
      </Note>
    </AuthCard>
  );
}
