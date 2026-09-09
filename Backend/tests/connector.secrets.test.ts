import { afterEach, describe, expect, it } from "vitest";
import {
  clearSecretCache,
  setSecretStore,
  type SecretStore,
} from "../src/common/secrets/secrets.js";
import {
  deleteConnectorTokens,
  readConnectorTokens,
  storeConnectorTokens,
  tokenSecretRef,
} from "../src/common/secrets/connectorTokens.js";
import { prisma } from "../src/config/prisma.js";

afterEach(() => {
  clearSecretCache();
  setSecretStore(new EnvWritableForTests());
});

class EnvWritableForTests implements SecretStore {
  readonly name = "test-memory";
  private values = new Map<string, string>();
  async get(ref: string) { return this.values.get(ref); }
  async set(ref: string, value: string) { this.values.set(ref, value); }
  async delete(ref: string) { this.values.delete(ref); }
}

const ctx = { purpose: "test" };

describe("connector tokens through the secret store — Security §15", () => {
  it("builds a deterministic, slug-safe ref per provider and account", () => {
    expect(tokenSecretRef("GMAIL", "user-123")).toBe("connector-oauth/gmail/user-123");
    expect(tokenSecretRef("MICROSOFT_365", "a b/c$d")).toMatch(/^connector-oauth\/microsoft_365\//);
    // Same inputs always yield the same ref (reconnect idempotency).
    expect(tokenSecretRef("GMAIL", "user-123")).toBe(tokenSecretRef("GMAIL", "user-123"));
  });

  it("round-trips access + refresh tokens without touching the database", async () => {
    const store = new EnvWritableForTests();
    setSecretStore(store);

    const ref = await storeConnectorTokens("GMAIL", "user-123", {
      accessToken: "at-1",
      refreshToken: "rt-1",
    }, ctx);
    expect(ref).toContain("gmail/user-123");

    const tokens = await readConnectorTokens("GMAIL", "user-123", ref, ctx);
    expect(tokens).toEqual({ accessToken: "at-1", refreshToken: "rt-1" });

    // The database row carries only the ref pointer.
    const account = await prisma.connectedAccount.findFirst({
      where: { tokenSecretRef: ref },
    });
    expect(account).toBeNull(); // no row was created; keeps DB untouched

    await deleteConnectorTokens("GMAIL", "user-123", ref, ctx);
    await expect(readConnectorTokens("GMAIL", "user-123", ref, ctx)).resolves.toBeUndefined();
  });

  it("returns undefined when a ref is absent or the secret is unreadable", async () => {
    const store = new EnvWritableForTests();
    setSecretStore(store);
    await expect(readConnectorTokens("GMAIL", "user-x", null, ctx)).resolves.toBeUndefined();
    // A ref with non-JSON payload is treated as missing, never thrown.
    await store.set("connector-oauth/gmail/user-bad", "not-json");
    await expect(readConnectorTokens("GMAIL", "user-bad", "connector-oauth/gmail/user-bad", ctx)).resolves.toBeUndefined();
  });
});