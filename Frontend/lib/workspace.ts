/**
 * The four workspaces, which are consoles rather than tenants.
 *
 * A session is bound to exactly one of these when it is issued, and the
 * binding is what stops a session opened for one console being carried into
 * another. The backend decides it and reports it on /auth/me; nothing here
 * infers it from an email, localStorage or a URL.
 */
export type WorkspaceScope = "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT";

/**
 * Where each workspace lives.
 *
 * SUPPORT means a tenant member holding the support role, and it lands on the
 * read-only /tenant-support page. Not /support: that is the platform console
 * for Zoiko staff, who authenticate with a platform token that carries no
 * workspace scope at all, so it is never reached through this map.
 */
export const WORKSPACE_HREF: Record<WorkspaceScope, string> = {
  OWNER: "/owner",
  ADMIN: "/admin",
  MEMBER: "/inbox",
  SUPPORT: "/tenant-support",
};

/**
 * The member workspace: a person's own mailbox, not an administration
 * console. Google sign-in always lands here whatever the account's role, so
 * reaching a console is always a deliberate sign-in aimed at it.
 */
export const USER_WORKSPACE_HREF = WORKSPACE_HREF.MEMBER;

/**
 * Where a session belongs, from the workspace the backend bound it to.
 *
 * Deliberately keyed on the scope rather than the role. They usually agree,
 * but a Google sign-in is MEMBER-scoped however senior the account is, and
 * routing on the role there would send an Owner to the owner console — the
 * thing the scope exists to prevent.
 */
export function resolveWorkspaceHref(scope?: string): string {
  if (scope && scope in WORKSPACE_HREF) {
    return WORKSPACE_HREF[scope as WorkspaceScope];
  }
  return USER_WORKSPACE_HREF;
}

// Lightweight workspace option for display purposes (no role stored).
export interface WorkspaceOption {
  id: string;
  name: string;
  planCode: string;
}

export const DEFAULT_WORKSPACE_OPTIONS: WorkspaceOption[] = [
  { id: "user", name: "User Workspace", planCode: "starter" },
];
/** Human names for the workspaces, for messages shown to people. */
export const WORKSPACE_LABEL: Record<WorkspaceScope, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  SUPPORT: "Support",
};

/**
 * Why a shell is turning someone away, in words they can act on.
 *
 * Every guard funnels through here so the three cases stay distinguishable.
 * They used to collapse into one silent redirect, and that is what made this
 * class of bug so expensive: a sign-in would succeed, a guard would bounce the
 * browser back to the login form, and nothing on screen or in the server log
 * said why. It has cost several rounds of "it stays on the login page".
 *
 * The third case is the one worth naming. A session that reports no workspace
 * at all is not an ended session — it is a server that predates workspace
 * scoping, so the client is asking for a field it does not send. Reporting
 * that as "your session ended" sends the user round the loop forever, because
 * signing in again produces exactly the same unscoped session.
 */
export function workspaceDenialNotice(
  required: WorkspaceScope,
  sessionScope?: string
): string {
  if (!sessionScope) {
    // Loud in the console, because this one is a deployment mismatch rather
    // than anything the person at the keyboard did.
    if (typeof console !== "undefined") {
      console.error(
        `[zoiko] /auth/me reported no workspace, so the ${required} workspace cannot verify this session. ` +
          "The API is older than this client — it needs the build that scopes sessions to a workspace."
      );
    }
    return "Sign-in is temporarily unavailable: the server did not say which workspace this session belongs to. This needs an updated API, not another sign-in attempt.";
  }

  const from = WORKSPACE_LABEL[sessionScope as WorkspaceScope] ?? "previous";
  const to = WORKSPACE_LABEL[required];
  return `You were signed in to the ${from} workspace. The ${to} workspace needs its own sign-in.`;
}
