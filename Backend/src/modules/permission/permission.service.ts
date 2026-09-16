import { CAPABILITIES, matrixKind, type Capability, type ResolverKind } from "../../common/capabilities/index.js";

/**
 * The permission surface for the admin "Roles & permissions" screen.
 *
 * The capability matrix and escalation guardrails live in code, not in the
 * database — they are the authoritative mapping the middleware enforces. These
 * read endpoints exist so the UI renders *that* mapping rather than a client
 * copy that can drift. The resolver kind → cell mapping mirrors what the admin
 * screen understands: allowed, denied, or conditional.
 */

/** How a resolver kind renders in the matrix cell. */
function cellFor(kind: ResolverKind | undefined): 1 | 0 | string {
  if (kind === undefined || kind === "DENY") return 0;
  if (kind === "ALLOW") return 1;
  switch (kind) {
    case "OWN":
      return "Own";
    case "READ_ONLY":
      return "Read-only";
    case "STEP_UP":
      return "Step-up";
    case "TWO_PERSON":
      return "2-person";
    case "GRANT":
      return "Approved grant";
  }
}

const GROUP_BY_CAPABILITY: Record<Capability, string> = {
  "mail.own.rw": "Own work",
  "commitments.own.manage": "Own work",
  "connector.own.connect": "Own work",
  "mail.other.read": "Own work",
  "people.read": "People",
  "people.invite.member": "People",
  "people.invite.admin": "People",
  "people.invite.owner": "People",
  "people.member.manage": "People",
  "people.admin.manage": "People",
  "people.owner.manage": "People",
  "people.mfa.reset": "People",
  "workspace.settings.read": "Workspace",
  "workspace.settings.write": "Workspace",
  "workspace.mailboxes.manage": "Workspace",
  "workspace.domains.manage": "Workspace",
  "workspace.groups.manage": "Workspace",
  "policy.write": "Workspace",
  "policy.security.write": "Workspace",
  "audit.read": "Workspace",
  "security-alert.read": "Workspace",
  "security-alert.review": "Workspace",
  "billing.read": "Money and liability",
  "billing.plan.write": "Money and liability",
  "data.export": "Money and liability",
  "tenant.ownership.transfer": "Money and liability",
  "tenant.delete": "Money and liability",
  "support.standing": "Support",
  "support.workspace.access": "Support",
  "support.grant.end": "Support",
};

const GROUP_ORDER = ["Own work", "People", "Workspace", "Money and liability", "Support"] as const;

export function permissionMatrix() {
  return GROUP_ORDER.map((group) => ({
    group,
    rows: CAPABILITIES.filter((capability) => GROUP_BY_CAPABILITY[capability] === group).map(
      (capability) => ({
        capability,
        member: cellFor(matrixKind("MEMBER", capability)),
        admin: cellFor(matrixKind("ADMIN", capability)),
        owner: cellFor(matrixKind("OWNER", capability)),
        support: cellFor(matrixKind("SUPPORT", capability)),
      })
    ),
  }));
}

export interface Guardrail {
  id: string;
  title: string;
  detail: string;
}

/**
 * Escalation guardrails, as documented. These are with the map so the admin
 * page and the enforcement code share a single description as well as a single
 * matrix.
 */
export function guardrails(): Guardrail[] {
  return [
    {
      id: "g1",
      title: "No granting above your own level",
      detail:
        "An Admin inviting an Owner is escalation by proxy. The endpoint compares the requested role against the caller's and refuses upward grants.",
    },
    {
      id: "g2",
      title: "No acting on someone senior",
      detail:
        "An Admin cannot suspend, demote or remove an Owner. The button is disabled and the call is rejected server-side.",
    },
    {
      id: "g3",
      title: "A workspace always keeps one Owner",
      detail:
        "Removing or demoting the last active Owner is refused, or the workspace becomes unadministrable and only Zoiko could rescue it.",
    },
    {
      id: "g4",
      title: "Role is read per request",
      detail:
        "Never cached in the session. Demote an Admin and it takes effect on their next call, not when they choose to sign out.",
    },
    {
      id: "g5",
      title: "Every query is tenant-scoped",
      detail:
        "An RBAC slip leaks a feature; a tenant-scoping slip leaks another company's mail. Row-level security makes a forgotten WHERE return nothing.",
    },
    {
      id: "g6",
      title: "Step-up for consequential acts",
      detail:
        "Transfer, export and delete re-authenticate inside a valid session. A stolen cookie must not be enough to hand over the workspace.",
    },
  ];
}