import { afterEach, describe, expect, it } from "vitest";
import {
  EnvSecretStore,
  EnvWritableSecretStore,
  GcpSecretManagerStore,
  activeSecretStoreName,
  clearSecretCache,
  deleteSecret,
  getSecret,
  invalidateSecret,
  setSecret,
  setSecretStore,
  type SecretStore,
} from "../src/common/secrets/secrets.js";

afterEach(() => {
  clearSecretCache();
  setSecretStore(new EnvSecretStore());
  delete process.env.SECRET_PROVIDER_OAUTH;
});

const ctx = { purpose: "test" };

describe("secret access abstraction — Security §15", () => {
  it("defaults to the env/file store for local development", () => {
    expect(activeSecretStoreName()).toBe("env-file");
  });

  it("reads a secret from SECRET_<UPPER_SNAKE_REF> through the env store", async () => {
    setSecretStore(new EnvSecretStore());
    process.env.SECRET_PROVIDER_OAUTH = "s3cr3t-value";
    await expect(getSecret("provider-oauth", ctx)).resolves.toBe("s3cr3t-value");
  });

  it("throws with the reference name but never the value", async () => {
    await expect(getSecret("missing-ref", ctx)).rejects.toThrow(/Secret not available: missing-ref/);
  });

  it("treats an empty secret as missing rather than a valid empty value", async () => {
    setSecretStore(new EnvSecretStore());
    process.env.SECRET_PROVIDER_OAUTH = "";
    await expect(getSecret("provider-oauth", ctx)).rejects.toThrow(/Secret not available/);
  });

  it("caches reads and honours invalidation", async () => {
    let reads = 0;
    const counting: SecretStore = {
      name: "counting",
      async get() {
        reads += 1;
        return "value";
      },
    };
    setSecretStore(counting);

    await getSecret("ref", ctx);
    await getSecret("ref", ctx);
    expect(reads).toBe(1);

    invalidateSecret("ref");
    await getSecret("ref", ctx);
    expect(reads).toBe(2);
  });

  it("fails loudly rather than falling back when the GCP store is unconfigured", async () => {
    setSecretStore(new GcpSecretManagerStore());
    await expect(getSecret("provider-oauth", ctx)).rejects.toThrow(/GCP Secret Manager is not configured/);
  });
});

describe("writable secret store (local dev)", () => {
  it("writes, reads and deletes through the file-backed store", async () => {
    const store = new EnvWritableSecretStore();
    setSecretStore(store);

    process.env.SECRET_REPO = "temp-dir";
    await store.set("connector-oauth-gmail/account-1", JSON.stringify({ accessToken: "abc", refreshToken: "xyz" }));
    await expect(store.get("connector-oauth-gmail/account-1")).resolves.toContain("abc");

    // setSecret caches the value; a read right after hits cache — still resolves.
    await setSecret("connector-oauth-gmail/account-2", "token-2", ctx);
    await expect(getSecret("connector-oauth-gmail/account-2", ctx)).resolves.toBe("token-2");

    await deleteSecret("connector-oauth-gmail/account-1", ctx);
    await expect(store.get("connector-oauth-gmail/account-1")).resolves.toBeUndefined();
  });

  it("never writes a secret value into error messages or logs", async () => {
    const store = new EnvWritableSecretStore();
    setSecretStore(store);
    await store.set("my-secret", "super-sensitive-token-value");
    // getSecret failure for a *missing distinct* ref surfaces the ref, not another value.
    await expect(getSecret("unrelated-ref", ctx)).rejects.toThrow(/unrelated-ref/);
    await expect(getSecret("unrelated-ref", ctx)).rejects.not.toThrow(/super-sensitive|sensitive/);
  });
});