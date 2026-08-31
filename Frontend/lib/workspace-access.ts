"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { isLoggedIn } from "./auth-storage";
import { useMe } from "./auth-hooks";
import type { MeResponse } from "./auth-api";

/**
 * Gate for a workspace shell, and deliberately fail-closed.
 *
 * The guards this replaces were written as:
 *
 *     if (me && !ALLOWED.includes(me.membership.role)) return <AccessDenied/>;
 *
 * The `me &&` is the hole. While useMe() is in flight `me` is undefined, so the
 * condition is false and the shell renders — a Member typing /admin got the
 * console during the fetch. Worse, useMe is disabled when a platform token is
 * present, so for those sessions `me` never resolves and the console renders
 * indefinitely. A guard that permits until proven otherwise is not a guard.
 *
 * This inverts it: "allowed" is returned only when a role is known and listed.
 * Loading, an error, a missing membership and a disallowed role all read the
 * same — not allowed — so the caller renders nothing either way.
 *
 * Denied callers are sent to /login rather than shown an access-denied screen.
 * That page has no redirect of its own for an existing session, so there is no
 * loop; and it avoids confirming to someone poking at URLs that a console
 * exists at that path at all.
 *
 * This is defence in depth, not the boundary itself. The API refuses each
 * request on its own capability check; this only stops the UI rendering
 * something the server would refuse anyway.
 */
export type WorkspaceAccess = "checking" | "allowed";

export function useWorkspaceAccess(allowedRoles: readonly string[]): WorkspaceAccess {
  const router = useRouter();
  const { data, isLoading, error } = useMe();

  const me = data as MeResponse | undefined;
  const authenticated = isLoggedIn();
  const role = me?.membership?.role;
  const allowed = authenticated && Boolean(role && allowedRoles.includes(role));

  useEffect(() => {
    if (!authenticated) {
      router.replace("/login");
      return;
    }
    // Still deciding: say nothing and render nothing.
    if (isLoading) return;

    // Resolved, and not permitted — including the cases where the identity
    // could not be established at all.
    if (error || !role || !allowedRoles.includes(role)) {
      router.replace("/login");
    }
  }, [authenticated, isLoading, error, role, allowedRoles, router]);

  return allowed ? "allowed" : "checking";
}
