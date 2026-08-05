'use client';

import { useEffect } from 'react';
import { AuthCard, AuthHeading } from '@/components/layout/AuthCard';
import { Banner } from '@/components/common/Banner';
import { StepIndicator } from '@/components/common/StepIndicator';
import { WorkspaceOption } from '@/components/forms/WorkspaceOption';
import { Button } from '@/components/ui/Button';
import { useSignInFlow } from '@/hooks/useSignInFlow';
import { useAuthStore } from '@/store/auth-store';
import { trackFunnel } from '@/services/telemetry';
import { displayRole } from '@/utils/format';

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five'] as const;

/**
 * STATE 5 · Choose workspace
 * Feature 3 · Security §4.2, §6 · API §5
 *
 * Explicit selection is required, not inferred. Security §6 makes the switch
 * a security event: it refreshes authorization context and clears cached
 * tenant-scoped data. Workspaces whose membership is removed, or whose tenant
 * is deleted, are not listed at all.
 */
export function WorkspaceChooser() {
  const selectable = useAuthStore((s) => s.selectableWorkspaces());
  const selectedId = useAuthStore((s) => s.selectedWorkspaceId);
  const selectWorkspace = useAuthStore((s) => s.selectWorkspace);
  const { chooseWorkspace, busy } = useSignInFlow();

  useEffect(() => {
    trackFunnel('workspace_viewed', { count: selectable.length });
  }, [selectable.length]);

  const selected = selectable.find((w) => w.id === selectedId) ?? selectable[0];
  const word = COUNT_WORDS[selectable.length] ?? String(selectable.length);

  return (
    <AuthCard wide>
      <StepIndicator current={4} />

      <AuthHeading title="Choose a workspace">
        You belong to {word}. Your role differs in each — nothing carries across.
      </AuthHeading>

      <div className="flex flex-col gap-2.5">
        {selectable.map((workspace) => (
          <WorkspaceOption
            key={workspace.id}
            workspace={workspace}
            caption={`${displayRole(workspace.role)} · ${workspace.members} members · active`}
            selected={selected?.id === workspace.id}
            onSelect={() => selectWorkspace(workspace.id)}
          />
        ))}
      </div>

      <Button
        variant="primary"
        loading={busy('workspace')}
        disabled={!selected}
        onClick={() => selected && void chooseWorkspace(selected.id)}
      >
        Continue to {selected?.name ?? 'workspace'}
      </Button>

      <Banner tone="info">
        Selection refreshes authorization context and clears cached tenant data. Workspaces with status{' '}
        <span className="font-mono">removed</span> or <span className="font-mono">deleted</span> are not listed —
        Security §6.
      </Banner>
    </AuthCard>
  );
}
