import { ROUTES } from './routes';

/**
 * Credential-driven scenario resolution.
 *
 * The sign-in page shows exactly three controls — email, password, Proceed.
 * Every other screen is an *outcome the platform routes to*, never something
 * the user browses to. This file is the mapping that decides which.
 *
 * In production the resolution happens server-side from AppUser.status,
 * TenantMembership.status, Tenant.status and the risk signals in Security §5.
 * The table here mirrors that logic so the frontend can be reviewed and
 * demonstrated before those endpoints exist; the shape of the answer is
 * identical, so swapping in the real call changes nothing downstream.
 */

export type Outcome =
  /** Credentials good — continue the happy path. */
  | 'mfa'
  /** Credentials wrong. */
  | 'failed'
  /** Too many failures. */
  | 'locked'
  /** Terminal account or tenant states. */
  | 'accountSuspended'
  | 'invitationPending'
  | 'noWorkspace'
  | 'membershipSuspended'
  | 'workspaceSuspended'
  | 'workspaceDeleting'
  | 'dormant'
  | 'blocked';

export interface Scenario {
  outcome: Outcome;
  /** Memberships the caller may choose between, when they get that far. */
  workspaceIds?: string[];
  /** Given name, used by the welcome state. */
  firstName?: string;
  /**
   * True when the platform resolves this before checking the password.
   *
   * Security §7.2 evaluates account and tenant status at steps 3 and 4, ahead
   * of the credential check. Verifying a password for an account that cannot
   * sign in either way would tell an attacker whether the password was right.
   */
  preCredential?: boolean;
}

/** Demo credential. Replaced by the real identity provider at integration. */
export const DEMO_PASSWORD = 'Zoiko2026!';

/** Failures tolerated before the account locks — Runbook §6.4. */
export const MAX_ATTEMPTS = 5;

/** Lock duration in seconds, 14:52 to match the design. */
export const LOCK_SECONDS = 892;

/**
 * Keyed on the local part — the text before the @ — so the domain is
 * irrelevant. `suspended@acme.com`, `suspended@gmail.com` and
 * `suspended@anything.co.uk` all resolve identically.
 *
 * That matters because Zoiko Mail's own users arrive with whatever address
 * their workspace invited, commonly a Google Workspace or Gmail one. Pinning
 * the demo to a single domain made every realistic address fall through.
 */
export const SCENARIOS: Record<string, Scenario> = {
  alex: { outcome: 'mfa', workspaceIds: ['ten_acme', 'ten_meridian'], firstName: 'Alex' },
  sarah: { outcome: 'mfa', workspaceIds: ['ten_acme'], firstName: 'Sarah' },
  suspended: { outcome: 'accountSuspended', preCredential: true },
  invited: { outcome: 'invitationPending', preCredential: true },
  newstarter: { outcome: 'noWorkspace', workspaceIds: [] },
  contractor: { outcome: 'membershipSuspended' },
  ops: { outcome: 'workspaceSuspended' },
  legacy: { outcome: 'workspaceDeleting' },
  tomas: { outcome: 'dormant', preCredential: true },
  risky: { outcome: 'blocked', preCredential: true },
};

/**
 * Any address that matches no scenario is treated as an ordinary member of one
 * workspace. A valid person with a correct password should get in — returning a
 * failure would be a lie about why they were refused.
 */
const ORDINARY_USER: Scenario = { outcome: 'mfa', workspaceIds: ['ten_acme'] };

/** Local part, lowercased, with any +tag stripped. */
function localPart(email: string): string {
  return email.trim().toLowerCase().split('@')[0].split('+')[0];
}

/** Title-cases the local part for the welcome greeting. */
function inferFirstName(email: string): string {
  const raw = localPart(email).replace(/[._-]+/g, ' ').trim().split(' ')[0];
  if (!raw) return 'there';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Where each outcome sends the caller. */
export const OUTCOME_ROUTE: Record<Outcome, string> = {
  mfa: ROUTES.mfa,
  failed: ROUTES.failed,
  locked: ROUTES.locked,
  accountSuspended: ROUTES.accountSuspended,
  invitationPending: ROUTES.invitationPending,
  noWorkspace: ROUTES.noWorkspace,
  membershipSuspended: ROUTES.membershipSuspended,
  workspaceSuspended: ROUTES.workspaceSuspended,
  workspaceDeleting: ROUTES.workspaceDeleting,
  dormant: ROUTES.dormant,
  blocked: ROUTES.blocked,
};

/**
 * Resolve a credential pair to an outcome.
 *
 * Order matters and mirrors Security §7.2:
 *   1. Pre-credential account and tenant states win outright.
 *   2. Then the password is checked.
 *   3. Then the remaining membership and tenant states apply.
 */
export function resolveScenario(email: string, password: string, priorAttempts: number): Scenario {
  const scenario = SCENARIOS[localPart(email)];

  if (scenario?.preCredential) return scenario;

  if (password !== DEMO_PASSWORD) {
    return priorAttempts + 1 >= MAX_ATTEMPTS ? { outcome: 'locked' } : { outcome: 'failed' };
  }

  if (scenario) {
    return { ...scenario, firstName: scenario.firstName ?? inferFirstName(email) };
  }

  return { ...ORDINARY_USER, firstName: inferFirstName(email) };
}
