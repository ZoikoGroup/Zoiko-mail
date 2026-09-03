"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { clearTokens, isLoggedIn, setSignOutNotice } from "./auth-storage";
import { useMe } from "./auth-hooks";
import type { MeResponse } from "./auth-api";
import { workspaceDenialNotice, type WorkspaceScope } from "./workspace";

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

/**
 * Gate for a workspace shell: the session must have been opened for *this*
 * workspace.
 *
 * Gating on the role was not enough, and that is the hole this closes. An
 * Admin who signed into the admin console could type /owner and the owner
 * console rendered, because its guard asked "is this role allowed here?" and
 * an Admin is allowed on much of the owner surface. The question that matters
 * is "was this session opened for this console?", and only the workspace scope
 * answers it.
 *
 * A mismatch destroys the session rather than merely redirecting. The rule is
 * that moving between workspaces needs a fresh sign-in, so leaving the old
 * session intact would let the browser go straight back to where it came from.
 */
export function useWorkspaceAccess(workspace: WorkspaceScope): WorkspaceAccess {
  const router = useRouter();
  const { data, isLoading, error } = useMe();

  const me = data as MeResponse | undefined;
  const authenticated = isLoggedIn();
  const sessionWorkspace = me?.workspace;
  const allowed = authenticated && sessionWorkspace === workspace;

  useEffect(() => {
    if (!authenticated) {
      router.replace("/login");
      return;
    }
    // Still deciding: say nothing and render nothing.
    if (isLoading) return;

    // The identity could not be established at all — the api client has
    // already explained anything it knew about, so say nothing over the top.
    if (error) {
      router.replace("/login");
      return;
    }

    if (sessionWorkspace === workspace) return;

    // Either the session belongs to another workspace, or it reports none at
    // all. Both are refused, and both say which — a bare redirect here is
    // what made this class of bug invisible.
    setSignOutNotice(workspaceDenialNotice(workspace, sessionWorkspace));
    clearTokens();
    router.replace("/login");
  }, [authenticated, isLoading, error, sessionWorkspace, workspace, router]);

  return allowed ? "allowed" : "checking";
}
