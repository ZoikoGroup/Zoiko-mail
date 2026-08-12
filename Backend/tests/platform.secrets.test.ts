import { afterEach, describe, expect, it } from "vitest";
import {
  EnvSecretStore,
  GcpSecretManagerStore,
  activeSecretStoreName,
  clearSecretCache,
  getSecret,
  invalidateSecret,
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
  it("defaults to the env store for local development", () => {
    expect(activeSecretStoreName()).toBe("env");
  });

  it("reads a secret from SECRET_<UPPER_SNAKE_REF>", async () => {
    process.env.SECRET_PROVIDER_OAUTH = "s3cr3t-value";
    await expect(getSecret("provider-oauth", ctx)).resolves.toBe("s3cr3t-value");
  });

  it("throws with the reference name but never the value", async () => {
    await expect(getSecret("missing-ref", ctx)).rejects.toThrow(/Secret not available: missing-ref/);
  });

  it("treats an empty secret as missing rather than a valid empty value", async () => {
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

  it("fails loudly rather than falling back when the GCP store is unwired", async () => {
    setSecretStore(new GcpSecretManagerStore());
    await expect(getSecret("provider-oauth", ctx)).rejects.toThrow(/not wired yet/);
  });
});
