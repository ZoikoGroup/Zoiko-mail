import { afterEach, describe, expect, it } from "vitest";
import {
  FLAGS,
  assertFlagEnabled,
  flagSnapshot,
  isFlagEnabled,
  setFlagOverrideResolver,
} from "../src/common/flags/index.js";

afterEach(() => {
  setFlagOverrideResolver(undefined);
});

describe("feature flags — Infrastructure §15", () => {
  it("declares all eight named flags", () => {
    expect(FLAGS).toHaveLength(8);
    expect(FLAGS).toContain("outbound_sending_enabled");
    expect(FLAGS).toContain("hosted_mail_pilot_enabled");
    expect(FLAGS).toContain("provider_callbacks_accepting");
  });

  it("defaults Track B capabilities to off so hosted mail ships disabled", () => {
    expect(isFlagEnabled("hosted_mail_pilot_enabled")).toBe(false);
    expect(isFlagEnabled("custom_domain_enabled")).toBe(false);
  });

  it("defaults Track A capabilities to on", () => {
    expect(isFlagEnabled("connector_gmail_enabled")).toBe(true);
    expect(isFlagEnabled("ai_extraction_enabled")).toBe(true);
  });

  it("lets a narrower scope disable an enabled capability", () => {
    setFlagOverrideResolver((name, scope) =>
      name === "outbound_sending_enabled" && scope.mailboxId === "mbx-suspended" ? false : undefined
    );

    expect(isFlagEnabled("outbound_sending_enabled", { mailboxId: "mbx-suspended" })).toBe(false);
    expect(isFlagEnabled("outbound_sending_enabled", { mailboxId: "mbx-healthy" })).toBe(true);
  });

  it("treats a global off as a kill switch that no override can re-enable", () => {
    // hosted_mail_pilot_enabled is globally false by default.
    setFlagOverrideResolver(() => true);
    expect(isFlagEnabled("hosted_mail_pilot_enabled", { tenantId: "t1" })).toBe(false);
  });

  it("rejects a scope the flag does not support", () => {
    // custom_domain_enabled is tenant-scoped only.
    expect(() => isFlagEnabled("custom_domain_enabled", { mailboxId: "mbx-1" })).toThrow(
      /cannot be scoped by mailboxId/
    );
  });

  it("ignores undefined scope keys rather than rejecting them", () => {
    expect(() => isFlagEnabled("custom_domain_enabled", { mailboxId: undefined })).not.toThrow();
  });

  it("assertFlagEnabled throws 403 FEATURE_DISABLED when off", () => {
    try {
      assertFlagEnabled("hosted_mail_pilot_enabled");
      expect.unreachable("expected assertFlagEnabled to throw");
    } catch (error) {
      const appError = error as { statusCode?: number; code?: string };
      expect(appError.statusCode).toBe(403);
      expect(appError.code).toBe("FEATURE_DISABLED");
    }
  });

  it("assertFlagEnabled passes when on", () => {
    expect(() => assertFlagEnabled("connector_gmail_enabled")).not.toThrow();
  });

  it("snapshot covers every flag and only passes supported scope keys", () => {
    const snapshot = flagSnapshot({ tenantId: "t1", mailboxId: "mbx-1", provider: "gmail" });
    expect(Object.keys(snapshot).sort()).toEqual([...FLAGS].sort());
    expect(snapshot.hosted_mail_pilot_enabled).toBe(false);
    expect(snapshot.connector_gmail_enabled).toBe(true);
  });
});
