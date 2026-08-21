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
  "policy.write",
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
  "support.grant.end",
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
