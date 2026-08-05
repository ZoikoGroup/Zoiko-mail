'use client';

import { AuthCard, AuthHeading } from '@/components/layout/AuthCard';
import { Banner } from '@/components/common/Banner';
import { WorkspaceOption } from '@/components/forms/WorkspaceOption';
import { Button } from '@/components/ui/Button';
import { Note } from '@/components/ui/Card';
import { useSignInFlow } from '@/hooks/useSignInFlow';
import { useAuthStore } from '@/store/auth-store';

/**
 * STATE 12 · Membership suspended
 * Feature 5 · Data Model §6.3 (TenantMembership.status = suspended)
 *
 * Distinct from both account suspension and workspace suspension, and the
 * distinction matters operationally: the workspace is running normally, so the
 * user must contact that workspace's administrator rather than Zoiko support.
 * Getting this wrong sends a ticket to the wrong place.
 *
 * The unavailable row stays visible — a silently missing workspace reads as a
 * bug.
 */
export default function MembershipSuspendedPage() {
  const workspaces = useAuthStore((s) => s.workspaces);
  const { chooseWorkspace, busy } = useSignInFlow();

  const [blocked, available] = workspaces;

  return (
    <AuthCard wide>
      <AuthHeading title="Choose a workspace">Your access to one of these has been suspended.</AuthHeading>

      <div className="flex flex-col gap-2.5">
        <WorkspaceOption workspace={blocked} caption="Your access suspended · workspace is active" unavailable />
        <WorkspaceOption workspace={available} caption="Member · active" selected />
      </div>

      <Button variant="primary" loading={busy('workspace')} onClick={() => void chooseWorkspace(available.id)}>
        Continue to {available.name}
      </Button>

      <Banner tone="warn">
        <b>{blocked.name} itself is running normally.</b> An administrator there suspended <i>your</i> membership. Only
        an Owner or Admin at {blocked.name} can restore it — contact them, not Zoiko.
      </Banner>

      <Note>Membership.status = suspended — distinct from AppUser.status and Tenant.status · Data Model §6.3.</Note>
    </AuthCard>
  );
}
