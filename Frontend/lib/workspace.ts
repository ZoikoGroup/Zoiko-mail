/**
 * The four workspaces, which are consoles rather than tenants.
 *
 * A session is bound to exactly one of these when it is issued, and the
 * binding is what stops a session opened for one console being carried into
 * another. The backend decides it and reports it on /auth/me; nothing here
 * infers it from an email, localStorage or a URL.
 */
export type WorkspaceScope = "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT";

/** Where each workspace lives. */
export const WORKSPACE_HREF: Record<WorkspaceScope, string> = {
  OWNER: "/owner",
  ADMIN: "/admin",
  MEMBER: "/inbox",
  SUPPORT: "/support",
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