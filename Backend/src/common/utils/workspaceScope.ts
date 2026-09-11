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
 * §7.2. The session scope is which console this sign-in was for, so a senior
 * account on a MEMBER-scoped session (every Google sign-in) acts as a member
 * and cannot use owner or admin endpoints by holding a token from a mailbox
 * sign-in.
 *
 * Returns null when the two are incompatible rather than picking one: a
 * SUPPORT session on a non-support membership, or the reverse, is not a
 * narrowing question but a session that does not belong here at all.
 */
export function actingRole(
  membershipRole: MembershipRole,
  workspace: WorkspaceScope
): MembershipRole | null {
  if (membershipRole === "SUPPORT" || workspace === "SUPPORT") {
    return membershipRole === workspace ? membershipRole : null;
  }

  const held = RANK[membershipRole as Exclude<MembershipRole, "SUPPORT">];
  const opened = RANK[workspace as Exclude<MembershipRole, "SUPPORT">];
  return held <= opened ? membershipRole : (workspace as MembershipRole);
}
