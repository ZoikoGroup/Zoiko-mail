import { env } from "./env.js";

/**
 * Feature flags — QA §7.
 *
 * The certification plan names "feature flag available" as an *entry*
 * criterion for Feature QA, alongside "code merged to test branch" and "unit
 * tests passed". Nothing here had one, so that gate could not be met however
 * well the feature itself worked.
 *
 * Deliberately small. A flag service with targeting rules, percentages and its
 * own storage is a second permission system, and this product already has one
 * that is audited and tested — the capability matrix. What §7 asks for is the
 * ability to merge a feature dark and turn it on per environment, and that is
 * an environment variable.
 *
 * So the rules are:
 *
 *  - A flag gates *rollout*, never authorisation. If the answer depends on who
 *    is asking, it is a capability and belongs in the matrix.
 *  - Flags are read through `isEnabled`, never `process.env` directly, so the
 *    set is enumerable — `GET /config/features` can answer honestly, and a
 *    flag cannot be removed from code while some environment still sets it.
 *  - Default off. A flag that defaults on is not a flag; it is a feature with
 *    an undocumented kill switch.
 */

/** Every flag this build knows about. Adding one here is what makes it real. */
export const FEATURE_FLAGS = {
  /**
   * Delegating a personal mailbox (RBAC §9.1). Ships behind a flag because it
   * is the first write that grants one person access to another's mail, and a
   * pilot tenant should be able to have the rest of this release without it.
   */
  MAILBOX_DELEGATION: "mailbox_delegation",
  /**
   * The Admin data screen — export and deletion requests raised by an Admin
   * rather than an Owner (RBAC §2 "By policy", PRD §16).
   */
  ADMIN_DATA_LIFECYCLE: "admin_data_lifecycle",
  /**
   * Rotating a provider credential from the console. Separate from the
   * delegation flag: an operator may need this during an incident in an
   * environment where delegation is still dark.
   */
  CONNECTOR_CREDENTIAL_ROTATION: "connector_credential_rotation",
} as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

/**
 * The enabled set, parsed once.
 *
 * `FEATURE_FLAGS=mailbox_delegation,admin_data_lifecycle` in the environment.
 * An unknown name is kept rather than dropped — a typo that silently enables
 * nothing is worse than one that shows up in the listing as unrecognised.
 */
const enabled = new Set(
  (env.FEATURE_FLAGS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
);

const known = new Set<string>(Object.values(FEATURE_FLAGS));

export function isEnabled(flag: FeatureFlag): boolean {
  return enabled.has(flag);
}

/**
 * What this build knows and what is on, for `GET /config/features` and for a
 * deploy check that wants to prove a flag reached the environment it was set
 * in. Names the unrecognised entries too, because a flag set but misspelled
 * looks exactly like a flag that was never set.
 */
export function featureFlagState(): {
  flags: { name: string; enabled: boolean }[];
  unrecognised: string[];
} {
  return {
    flags: Object.values(FEATURE_FLAGS).map((name) => ({ name, enabled: enabled.has(name) })),
    unrecognised: [...enabled].filter((name) => !known.has(name)),
  };
}
