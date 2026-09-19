/**
 * The capability vocabulary — Security spec §7.2, evaluation step 6.
 *
 * Role is step 5 of ten, not the gate. This module exists so authorization
 * asks "does the caller hold this capability?" instead of "is the caller an
 * ADMIN?", which is the difference between adding a fifth role as a data
 * change and hunting through every security-relevant branch in the codebase.
 *
 * The list is deliberately identical to Frontend/lib/admin-capabilities.ts.
 * If the two ever disagree the UI will offer buttons the API refuses, which
 * reads to the user as a bug in the product rather than a permission boundary.
 */

export const CAPABILITIES = [
  // Own work — a member acting on their own resources.
  "mail.own.rw",
  "commitments.own.manage",
  "connector.own.connect",
  "mail.other.read",
  // People.
  "people.read",
  "people.invite.member",
  "people.invite.admin",
  "people.invite.owner",
  "people.member.manage",
  "people.admin.manage",
  "people.owner.manage",
  "people.mfa.reset",
  // Workspace.
  "workspace.settings.read",
  "workspace.settings.write",
  "workspace.mailboxes.manage",
  "workspace.domains.manage",
  "workspace.groups.manage",
  // Split out of the "manage" capabilities above rather than folded into
  // them, because RBAC §2 requires step-up on the destructive half only.
  // Marking workspace.domains.manage STEP_UP would have demanded a fresh
  // password to *add* a domain, which turns a routine action into a ritual
  // and teaches people to re-authenticate without reading why.
  "workspace.domains.remove",
  "workspace.mailboxes.delete",
  "workspace.mailboxes.sending",
  "connector.credentials.rotate",
  "connector.tenant.disconnect",
  "mailbox.delegate",
  "policy.write",
  // "Change AI policy" and "Enable AI on restricted mailbox" are both
  // step-up in RBAC §2, and both are narrower than policy.write.
  "policy.ai.write",
  "mailbox.ai.enable",
  "policy.security.write",
  "audit.read",
  // Money and liability.
  "billing.read",
  "billing.plan.write",
  "data.export",
  "tenant.ownership.transfer",
  "tenant.delete",
  // Support.
  "support.standing",
  "support.workspace.access",
  // Security §5 lists "support access grant" among the high-risk actions that
  // require step-up. Granting a stranger access to a tenant is exactly that,
  // and the route gated on a bare role.
  "support.grant.create",
  "support.grant.end",
  /**
   * Reading the support console for one workspace.
   *
   * Held ALLOW by Owner and Admin — it is their own workspace, and the console
   * shows them diagnostics they can already reach elsewhere. Held GRANT by
   * Support, which is the whole point: Runbook §7 gives Zoiko support "no
   * default right", so the same screen that is routine for an Owner is
   * time-boxed for a Support seat and stops working when the grant expires.
   *
   * These routes were gated on requireRole("OWNER","ADMIN","SUPPORT"), which
   * cannot express that difference — a role check says who you are, and the
   * question here is what you currently hold.
   */
  "support.console.read",
  /**
   * Seeing who currently holds access to this workspace.
   *
   * Owner and Admin only, and deliberately not folded into
   * `support.console.read`: that one is GRANT for Support, so reusing it would
   * have let a granted Support member read the access list — including other
   * people's grants. Replacing a role gate is not a reason to widen what it
   * guarded.
   */
  "support.grant.read",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(CAPABILITIES);

export function isCapability(value: string): value is Capability {
  return CAPABILITY_SET.has(value);
}

/**
 * How a capability is held. The kind is what makes the matrix expressive
 * enough to describe a real permission model in data rather than in branches.
 *
 *  ALLOW       granted outright
 *  DENY        refused; the reason names who does hold it
 *  READ_ONLY   may observe, may not mutate
 *  OWN         granted, but only over the caller's own resources
 *  STEP_UP     granted once the caller re-authenticates
 *  TWO_PERSON  granted once a second authorised principal approves
 *  GRANT       granted only while an explicit, time-boxed grant is active
 */
export const RESOLVER_KINDS = [
  "ALLOW",
  "DENY",
  "READ_ONLY",
  "OWN",
  "STEP_UP",
  "TWO_PERSON",
  "GRANT",
] as const;

export type ResolverKind = (typeof RESOLVER_KINDS)[number];

/**
 * Why a decision came out the way it did.
 *
 * This is the half of the contract that the admin workspace needs most. A
 * bare boolean makes every denial look identical, so the UI can only grey a
 * button out; a reason lets it say "an Owner holds this" or "confirm your
 * password to continue", which is the difference between a dead end and a
 * next step.
 */
export const REASONS = [
  "ALLOWED",
  "ALLOWED_OWN_RESOURCE",
  "ALLOWED_READ_ONLY",
  "NO_MEMBERSHIP",
  "MEMBERSHIP_INACTIVE",
  "ROLE_LACKS_CAPABILITY",
  "REQUIRES_STEP_UP",
  "REQUIRES_SECOND_APPROVER",
  "REQUIRES_SUPPORT_GRANT",
  "UNKNOWN_CAPABILITY",
] as const;

export type Reason = (typeof REASONS)[number];
