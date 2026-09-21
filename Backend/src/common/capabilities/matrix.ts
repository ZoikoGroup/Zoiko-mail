import type { MembershipRole } from "@prisma/client";
import { CAPABILITIES, type Capability, type ResolverKind } from "./capabilities.js";

/**
 * The capability matrix: role × capability → how it is held.
 *
 * Two rules this table encodes that are easy to lose in prose:
 *
 *  1. **Owner is a superset of Admin.** Nothing is Admin-exclusive at the
 *     capability level. What separates them is that Owner holds the liability
 *     capabilities — billing, export, ownership transfer, deletion — and
 *     Admin holds none of them. Admin is the bounded operator.
 *
 *  2. **The two splits that define the boundary.** `policy.write` (Admin) vs
 *     `policy.security.write` (Owner), and `audit.read` (Admin) vs
 *     `data.export` (Owner). Admin authors inside a frame Owner locks, and
 *     investigates what Owner attests to.
 *
 * An omitted entry is a denial. Denial is the default so that adding a
 * capability to the vocabulary cannot silently widen anyone's access.
 */
type RoleMatrix = Partial<Record<Capability, ResolverKind>>;

const OWNER: RoleMatrix = {
  // Own work.
  "mail.own.rw": "OWN",
  "commitments.own.manage": "OWN",
  "connector.own.connect": "OWN",
  // `mail.other.read` is deliberately absent. RBAC §2 records Owner = No and
  // Admin = No for "Read private user mailbox": AC-005 denies both by default,
  // and no amount of re-authentication changes that. Only the Support path,
  // via an approved grant, can reach private content at all. Treating this as
  // step-up would have let an Owner read any mailbox by confirming a password.
  // People — an Owner is the only principal that may act on another Owner.
  "people.read": "ALLOW",
  "people.invite.member": "ALLOW",
  "people.invite.admin": "ALLOW",
  "people.invite.owner": "ALLOW",
  "people.member.manage": "ALLOW",
  "people.admin.manage": "ALLOW",
  "people.owner.manage": "ALLOW",
  "people.mfa.reset": "STEP_UP",
  // Workspace.
  "workspace.settings.read": "ALLOW",
  "workspace.settings.write": "ALLOW",
  "workspace.mailboxes.manage": "ALLOW",
  "workspace.domains.manage": "ALLOW",
  "workspace.groups.manage": "ALLOW",
  // RBAC §2 marks these Step-up for Owner and Admin alike: destructive, or
  // outward-facing, or a change to what the assistant may do unsupervised.
  "workspace.domains.remove": "STEP_UP",
  "workspace.mailboxes.delete": "STEP_UP",
  // Suspending sending is reversible and is the "suspend-first" half of the
  // deletion flow, so it is not itself step-up.
  "workspace.mailboxes.sending": "ALLOW",
  "connector.credentials.rotate": "STEP_UP",
  "connector.tenant.disconnect": "ALLOW",
  "mailbox.delegate": "ALLOW",
  "policy.write": "ALLOW",
  "policy.ai.write": "STEP_UP",
  "mailbox.ai.enable": "STEP_UP",
  "policy.security.write": "ALLOW",
  "audit.read": "ALLOW",
  "security-alert.read": "ALLOW",
  "security-alert.review": "ALLOW",
  // Money and liability.
  "billing.read": "ALLOW",
  "billing.plan.write": "ALLOW",
  "data.export": "STEP_UP",
  // Irreversible and outward-facing: one principal is not enough.
  "tenant.ownership.transfer": "TWO_PERSON",
  "tenant.delete": "TWO_PERSON",
  // Support.
  // §11.1 step 3: the Owner authorises support access, and §5 lists granting
  // it beside tenant deletion and domain removal. Letting someone outside the
  // tenant in is not a routine administrative act, so it takes a fresh
  // password. Withheld from Admin entirely — the matrix gives Admin the
  // ability to *end* a grant, never to start one.
  "support.grant.create": "STEP_UP",
  "support.grant.end": "ALLOW",
  "support.console.read": "ALLOW",
  "support.grant.read": "ALLOW",
};

/**
 * Admin — the bounded operator, transcribed from the RBAC §2 matrix.
 *
 * Deliberately absent, each because the matrix says so: `people.owner.manage`
 * and `people.invite.owner` ("Admin cannot grant/alter Owner"), everything
 * under billing, `policy.security.write`, `tenant.delete`,
 * `tenant.ownership.transfer` ("Owner only, highly destructive"), and
 * `mail.other.read` (AC-005 denies Admin by default).
 */
const ADMIN: RoleMatrix = {
  "mail.own.rw": "OWN",
  "commitments.own.manage": "OWN",
  "connector.own.connect": "OWN",
  "people.read": "ALLOW",
  "people.invite.member": "ALLOW",
  // §2 "Invite users": Admin = Yes, with no restriction on the invited role
  // except Owner, which is withheld separately.
  "people.invite.admin": "ALLOW",
  "people.member.manage": "ALLOW",
  // §2 "Assign roles": Admin = Limited — "Admin cannot grant/alter Owner".
  // Limited means an Admin may act on another Admin; only the Owner row is
  // out of reach. The route gate opens on this capability and the service's
  // admin boundary refuses an Owner target, because seniority is a property
  // of the target row rather than of the capability.
  "people.admin.manage": "ALLOW",
  "workspace.settings.read": "ALLOW",
  "workspace.settings.write": "ALLOW",
  "workspace.mailboxes.manage": "ALLOW",
  "workspace.domains.manage": "ALLOW",
  "workspace.groups.manage": "ALLOW",
  // The step-up half of the manage capabilities above. These were the gap:
  // the actions shipped against workspace.domains.manage and
  // workspace.mailboxes.manage, which are ALLOW, so removing a domain or
  // changing AI policy needed no fresh authentication at all.
  "workspace.domains.remove": "STEP_UP",
  "workspace.mailboxes.delete": "STEP_UP",
  "workspace.mailboxes.sending": "ALLOW",
  // §2 "Rotate provider credentials": Admin = "If policy" + Step-up, and
  // §2 "Delegate mailbox access": Admin = "If policy". The policy half is
  // evaluation step 8 and belongs to the policy gate, not to the matrix.
  "connector.credentials.rotate": "STEP_UP",
  // §2 "Disconnect connected account": Admin = "Tenant scope".
  "connector.tenant.disconnect": "ALLOW",
  "mailbox.delegate": "ALLOW",
  "policy.write": "ALLOW",
  "policy.ai.write": "STEP_UP",
  "mailbox.ai.enable": "STEP_UP",
  // §2 "View audit log": Admin = Limited. The capability is held; the scoping
  // lives in the audit service, which withholds the Owner-reserved
  // governance categories. See ADMIN_AUDIT_EXCLUDED_PREFIXES.
  "audit.read": "ALLOW",
  // Admin is "the bounded operator", and triaging a security signal is
  // operator work — the alert screens shipped for Admin as well as Owner.
  // Not step-up: acknowledging or resolving is reversible and recorded, and
  // demanding a password to clear a new-device notice would teach people to
  // re-authenticate without reading why.
  "security-alert.read": "ALLOW",
  "security-alert.review": "ALLOW",
  // §2 "Request export": Admin = "By policy" + Step-up. Step-up is expressed
  // here; the policy half is evaluation step 8 and belongs to the policy gate,
  // not to the matrix.
  "data.export": "STEP_UP",
  // Support cannot end its own session — that would be self-marking homework.
  // The tenant-side principal watching the session is the one who can stop it.
  "support.grant.end": "ALLOW",
  "support.console.read": "ALLOW",
  "support.grant.read": "ALLOW",
};

const MEMBER: RoleMatrix = {
  "mail.own.rw": "OWN",
  "commitments.own.manage": "OWN",
  "connector.own.connect": "OWN",
  "workspace.settings.read": "READ_ONLY",
};

/**
 * Platform staff. Tenant data is reachable only through a time-boxed,
 * audited grant, never by virtue of being staff — hence GRANT rather than
 * ALLOW, and hence no tenant-administration capabilities at all.
 */
const SUPPORT: RoleMatrix = {
  "support.standing": "GRANT",
  "support.workspace.access": "GRANT",
  /**
   * The only path to private mail content anywhere in the matrix, and even
   * here it is not routine: §2 marks Support "⏱ grant", while §4 adds
   * "blocked by default; exceptional security-approved path only". GRANT
   * expresses the time-boxed approval; the security-approved exception is an
   * additional control that does not belong in a role matrix. Owner and Admin
   * hold this in no form at all.
   */
  "mail.other.read": "GRANT",
  /**
   * The console read itself is time-boxed for Support, so the screens stop
   * answering the moment the grant expires or is revoked — §7's "no default
   * right" and "must have an expiry", applied to the tenant-side console the
   * way requireTenantGrant applies them to the platform one.
   */
  "support.console.read": "GRANT",
};

export const CAPABILITY_MATRIX: Record<MembershipRole, RoleMatrix> = {
  OWNER,
  ADMIN,
  MEMBER,
  SUPPORT,
};

/** The kind for a role/capability pair, or undefined when not held at all. */
export function matrixKind(
  role: MembershipRole,
  capability: Capability
): ResolverKind | undefined {
  return CAPABILITY_MATRIX[role][capability];
}

/**
 * Which roles hold a capability at all. This is the "authority" half of a
 * denial: the admin workspace can tell the user who to ask instead of just
 * disabling a control with no explanation.
 */
export function rolesHolding(capability: Capability): MembershipRole[] {
  return (Object.keys(CAPABILITY_MATRIX) as MembershipRole[]).filter(
    (role) => CAPABILITY_MATRIX[role][capability] !== undefined
  );
}

/** Every capability a role holds in any form. Used to build the UI snapshot. */
export function capabilitiesFor(role: MembershipRole): Capability[] {
  return CAPABILITIES.filter((capability) => matrixKind(role, capability) !== undefined);
}
