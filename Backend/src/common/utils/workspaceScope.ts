import type { MembershipRole } from "@prisma/client";
import type { WorkspaceScope } from "../types/jwt.js";

/**
 * Privilege order for narrowing. SUPPORT is deliberately absent: it is a
 * different kind of access rather than a rung on this ladder, so it is
 * handled by exact match instead of comparison.
 */
const RANK: Record<Exclude<MembershipRole, "SUPPORT">, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/**
 * The authority a session actually carries: never more than the membership
 * grants, and never more than the session was opened for.
 *
 * Two independent limits, and taking the lesser of them matters for different
 * reasons. The membership is the live source of truth, so a user demoted
 * since their token was minted acts as their new role immediately — Security
 * §7.2. The session scope is which console this sign-in was for, so a session
 * scoped narrower than the role allows (a demotion, or a workspace selected
 * from a reduced seat) acts within that scope and cannot use owner or admin
 * endpoints by holding a token from a mailbox sign-in.
 *
 * Returns null when the two are incompatible rather than picking one: a
 * SUPPORT session on a non-support membership, or the reverse, is not a
 * narrowing question but a session that does not belong here at all.
 */
/** Every workspace console, in the order the UI lists them. */
export const WORKSPACE_SCOPES = ["MEMBER", "SUPPORT", "ADMIN", "OWNER"] as const satisfies readonly MembershipRole[];

/**
 * The consoles a person holding `role` can open a session for.
 *
 * Mirrors actingRole: a session may be opened at or below the membership's
 * rank, and SUPPORT is reachable only by SUPPORT. A mailbox assigned to a
 * console outside this set could never be opened by its owner, which is why
 * personal-mailbox assignments are checked against it.
 */
export function reachableWorkspaces(role: MembershipRole): MembershipRole[] {
  if (role === "SUPPORT") return ["SUPPORT"];
  const held = RANK[role];
  return (["MEMBER", "ADMIN", "OWNER"] as const).filter((scope) => RANK[scope] <= held);
}

export function actingRole(
  membershipRole: MembershipRole,
  workspace: WorkspaceScope
): MembershipRole | null {
  // The Member workspace is the floor every membership can stand on: the
  // Member sign-in opens it for anyone, including a Support seat, and acting
  // as a Member never reaches past what that membership already holds.
  if (workspace === "MEMBER") return "MEMBER";
  if (membershipRole === "SUPPORT" || workspace === "SUPPORT") {
    return membershipRole === workspace ? membershipRole : null;
  }

  const held = RANK[membershipRole as Exclude<MembershipRole, "SUPPORT">];
  const opened = RANK[workspace as Exclude<MembershipRole, "SUPPORT">];
  return held <= opened ? membershipRole : (workspace as MembershipRole);
}

/**
 * Whether a person may hold a session in `workspace`, given their role and the
 * workspaces an admin assigned to their personal mailbox.
 *
 * The Member workspace is always open. A privileged console (Admin, Owner,
 * Support) needs the person's mailbox to list it — the admin's Workspace
 * Access setting is the explicit authorisation. Whether the role reaches the
 * console is not asked here: sign-in only ever opens the role's own console,
 * and a role reduced mid-session is narrowed by actingRole rather than
 * refused, which is the existing demotion rule. Two safeguards keep the
 * setting from locking anyone out:
 *   - an Owner always reaches the Owner console, so no setting can strand the
 *     workspace without its owner;
 *   - a person with no personal mailbox (`mailboxWorkspaces` null) falls back
 *     to their role, because there is no setting to read.
 */
export function consoleAuthorized(
  membershipRole: MembershipRole,
  workspace: WorkspaceScope,
  mailboxWorkspaces: readonly MembershipRole[] | null
): boolean {
  if (workspace === "MEMBER") return true;
  if (membershipRole === "OWNER" && workspace === "OWNER") return true;
  if (mailboxWorkspaces === null) return true;
  return mailboxWorkspaces.includes(workspace);
}

/**
 * The console a sign-in opens.
 *
 * The Member sign-in asks for MEMBER and always gets it. Otherwise the role's
 * own console, when it is authorised; when it is not, the Member workspace,
 * which every membership may open.
 */
export function signInWorkspace(
  membershipRole: MembershipRole,
  mailboxWorkspaces: readonly MembershipRole[] | null,
  requested?: WorkspaceScope
): WorkspaceScope {
  if (requested === "MEMBER") return "MEMBER";
  const own = membershipRole as WorkspaceScope;
  return consoleAuthorized(membershipRole, own, mailboxWorkspaces) ? own : "MEMBER";
}
