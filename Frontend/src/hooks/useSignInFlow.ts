'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ROUTES } from '@/constants/routes';
import { OUTCOME_ROUTE, type Scenario } from '@/constants/scenarios';
import { authService } from '@/services/auth-service';
import { trackAudit, trackFunnel } from '@/services/telemetry';
import { useAuthStore } from '@/store/auth-store';

/**
 * Orchestrates sign-in so the pages stay declarative.
 *
 * The single external surface is email + password + Proceed. Everything that
 * happens after Proceed is resolved by the platform and routed to — the user
 * never selects their own account state.
 *
 * The brief settle delay is deliberate: an instant route change reads as a
 * glitch rather than progress.
 */
const SETTLE_MS = 300;

export function useSignInFlow() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState<string | null>(null);

  const {
    email,
    password,
    attempts,
    setLastOutcome,
    registerFailure,
    resetAttempts,
    applyWorkspaceIds,
    setFirstName,
    selectWorkspace,
    setSession,
    clearSession,
    resetForRetry,
    selectedWorkspaceId,
    credentialsEntered,
  } = useAuthStore();

  const busy = (key: string) => pending === key;

  /** Proceed. Resolves the scenario and routes to whatever it yields. */
  const proceed = useCallback(async () => {
    if (!credentialsEntered() || pending) return;

    setPending('proceed');
    trackFunnel('email_submitted', { domain: email.split('@')[1] ?? '' });

    let scenario: Scenario;
    try {
      scenario = await authService.signIn(email, password, attempts);
    } catch {
      // Nothing may leave the button spinning. An unresolvable attempt is
      // reported as the same generic failure the user would see anyway.
      scenario = { outcome: 'failed' };
    }

    // Failures are audited and counted; five in a row locks the account.
    if (scenario.outcome === 'failed') {
      registerFailure();
      trackAudit('failed_login', { stage: 'credentials' });
    } else if (scenario.outcome === 'locked') {
      registerFailure();
      trackAudit('failed_login', { stage: 'credentials', locked: true });
    } else {
      resetAttempts();
    }

    if (scenario.workspaceIds) applyWorkspaceIds(scenario.workspaceIds);
    if (scenario.firstName) setFirstName(scenario.firstName);
    setLastOutcome(scenario.outcome);

    // Falls back to the generic failure rather than pushing undefined, which
    // navigates nowhere and reads as a dead button.
    const target = OUTCOME_ROUTE[scenario.outcome] ?? ROUTES.failed;

    setTimeout(() => {
      setPending(null);
      // Pushing the route already showing is a no-op in the App Router, so a
      // second rejection would change nothing on screen. The banner reads
      // lastOutcome instead, which has just been set.
      if (target !== pathname) router.push(target);
    }, SETTLE_MS);
  }, [
    email,
    password,
    attempts,
    pending,
    pathname,
    credentialsEntered,
    registerFailure,
    resetAttempts,
    applyWorkspaceIds,
    setFirstName,
    setLastOutcome,
    router,
  ]);

  /** Verify the MFA code, then branch on how many memberships exist. */
  const verifyMfa = useCallback(
    async (code: string) => {
      setPending('mfa');
      const { verified } = await authService.verifyMfa(code);

      if (!verified) {
        setPending(null);
        registerFailure();
        trackAudit('failed_login', { stage: 'mfa' });
        router.push(ROUTES.failed);
        return;
      }

      trackFunnel('mfa_verified');

      const selectable = useAuthStore.getState().selectableWorkspaces();

      // API §5 requires an active tenant, but a single membership needs no
      // chooser — presenting a list of one is friction, not a choice.
      if (selectable.length <= 1) {
        const only = selectable[0];
        if (!only) {
          setPending(null);
          router.push(ROUTES.noWorkspace);
          return;
        }
        selectWorkspace(only.id);
        const session = await authService.selectWorkspace(only.id);
        setSession(session);
        trackFunnel('session_issued');
        trackAudit('login', { tenantId: only.id });
        setTimeout(() => {
          setPending(null);
          router.push(ROUTES.welcome);
        }, SETTLE_MS);
        return;
      }

      setTimeout(() => {
        setPending(null);
        router.push(ROUTES.workspaceSelect);
      }, SETTLE_MS);
    },
    [registerFailure, router, selectWorkspace, setSession],
  );

  const chooseWorkspace = useCallback(
    async (tenantId: string) => {
      setPending('workspace');
      selectWorkspace(tenantId);
      trackFunnel('workspace_selected', { tenantId });

      const session = await authService.selectWorkspace(tenantId);
      setSession(session);
      trackFunnel('session_issued');
      trackAudit('login', { tenantId });

      setTimeout(() => {
        setPending(null);
        router.push(ROUTES.welcome);
      }, SETTLE_MS);
    },
    [router, selectWorkspace, setSession],
  );

  /** Back to a clean sign-in from any terminal or arrival state. */
  const backToSignIn = useCallback(() => {
    resetForRetry();
    router.push(ROUTES.signIn);
  }, [resetForRetry, router]);

  const signOut = useCallback(async () => {
    setPending('signout');
    await authService.revokeAllSessions();
    clearSession();
    resetForRetry();
    router.push(ROUTES.signIn);
  }, [clearSession, resetForRetry, router]);

  return {
    email,
    password,
    selectedWorkspaceId,
    busy,
    pending,
    proceed,
    verifyMfa,
    chooseWorkspace,
    backToSignIn,
    signOut,
  };
}
