import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

/**
 * Feature flags — QA §7's Feature-QA entry criterion.
 *
 * Small enough to look untestable, and worth testing for exactly the reasons
 * it is small: the failure modes are a flag that defaults on, a flag that
 * cannot be turned on because its name is parsed differently from how it is
 * documented, and a misspelled flag that silently enables nothing. All three
 * present as "the feature behaves as though the flag does not exist".
 */

const FLAGS = "mailbox_delegation,admin_data_lifecycle,connector_credential_rotation";

async function loadWith(value: string) {
  // The module reads the environment once, at import — which is the point:
  // a flag must not change under a running process. So each case needs a
  // fresh module registry rather than a mutated singleton.
  vi.resetModules();
  process.env.FEATURE_FLAGS = value;
  return import("../src/config/featureFlags.js");
}

const original = process.env.FEATURE_FLAGS;

beforeEach(() => {
  process.env.FEATURE_FLAGS = "";
});

afterEach(() => {
  if (original === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = original;
  vi.resetModules();
});

describe("feature flags", () => {
  it("defaults every flag to off", async () => {
    const { FEATURE_FLAGS, isEnabled } = await loadWith("");
    // A flag that defaults on is not a flag; it is a feature with an
    // undocumented kill switch.
    for (const flag of Object.values(FEATURE_FLAGS)) {
      expect(isEnabled(flag), `${flag} should default off`).toBe(false);
    }
  });

  it("turns on exactly the flags it is given", async () => {
    const { FEATURE_FLAGS, isEnabled } = await loadWith("mailbox_delegation");
    expect(isEnabled(FEATURE_FLAGS.MAILBOX_DELEGATION)).toBe(true);
    expect(isEnabled(FEATURE_FLAGS.ADMIN_DATA_LIFECYCLE)).toBe(false);
  });

  it("tolerates the spacing and casing a deploy config actually contains", async () => {
    const { FEATURE_FLAGS, isEnabled } = await loadWith(
      "  Mailbox_Delegation ,, ADMIN_DATA_LIFECYCLE  ,"
    );
    // A flag that works locally and not in staging because the value had a
    // trailing comma is a bad afternoon.
    expect(isEnabled(FEATURE_FLAGS.MAILBOX_DELEGATION)).toBe(true);
    expect(isEnabled(FEATURE_FLAGS.ADMIN_DATA_LIFECYCLE)).toBe(true);
  });

  it("reports every known flag and its state", async () => {
    const { featureFlagState } = await loadWith("mailbox_delegation");
    const state = featureFlagState();
    expect(state.flags).toHaveLength(3);
    expect(state.flags.find((f) => f.name === "mailbox_delegation")?.enabled).toBe(true);
    expect(state.flags.find((f) => f.name === "admin_data_lifecycle")?.enabled).toBe(false);
  });

  it("names a flag it does not recognise instead of ignoring it", async () => {
    const { featureFlagState } = await loadWith("mailbox_delegaton");
    // A typo'd flag and an unset flag behave identically at runtime, so the
    // only way to tell them apart is to say so.
    expect(featureFlagState().unrecognised).toContain("mailbox_delegaton");
    expect(featureFlagState().flags.every((f) => !f.enabled)).toBe(true);
  });

  it("enables everything when every flag is listed", async () => {
    const { FEATURE_FLAGS, isEnabled, featureFlagState } = await loadWith(FLAGS);
    for (const flag of Object.values(FEATURE_FLAGS)) {
      expect(isEnabled(flag)).toBe(true);
    }
    expect(featureFlagState().unrecognised).toEqual([]);
  });
});
