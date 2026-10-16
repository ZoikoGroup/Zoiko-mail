import { afterEach, describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
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
  type SecretManagerClientLike,
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
/**
 * A stand-in for Google's client that enforces the rules Google enforces. The
 * real one is unreachable from tests, which is how a request Google rejects
 * (a new secret with no replication policy) shipped and then failed every save
 * of a DKIM key, DNS token or connector token on the live server.
 */
function fakeGoogle(opts: { existing?: boolean; createError?: { code: number } } = {}) {
  const calls = { createSecret: [] as any[], addSecretVersion: [] as any[] };
  const client = {
    async createSecret(request: any) {
      calls.createSecret.push(request);
      if (opts.createError) throw Object.assign(new Error("create refused"), opts.createError);
      if (opts.existing) throw Object.assign(new Error("exists"), { code: 6 });
      // Google's own validation.
      if (!request.secret?.replication) {
        throw Object.assign(new Error("3 INVALID_ARGUMENT: Secret.replication must be provided."), { code: 3 });
      }
      return [{}];
    },
    async addSecretVersion(request: any) {
      calls.addSecretVersion.push(request);
      return [{}];
    },
    async accessSecretVersion() {
      return [{ payload: { data: Buffer.from("stored-value") } }];
    },
    async deleteSecret() {
      return [{}];
    },
  } as unknown as SecretManagerClientLike;
  return { client, calls };
}

describe("Google Secret Manager store", () => {
  const mutableEnv = env as { SECRET_MANAGER_PROJECT?: string };
  const before = mutableEnv.SECRET_MANAGER_PROJECT;
  afterEach(() => {
    mutableEnv.SECRET_MANAGER_PROJECT = before;
  });

  it("creates a new secret with a replication policy, then stores the value as a version", async () => {
    mutableEnv.SECRET_MANAGER_PROJECT = "test-project";
    const { client, calls } = fakeGoogle();
    await new GcpSecretManagerStore(client).set("dns-provider/abc-123", "the-token");

    expect(calls.createSecret).toHaveLength(1);
    expect(calls.createSecret[0]).toMatchObject({
      parent: "projects/test-project",
      secretId: "dns-provider-abc-123",
      secret: { replication: { automatic: {} } },
    });
    expect(calls.addSecretVersion).toHaveLength(1);
    expect(calls.addSecretVersion[0].parent).toBe("projects/test-project/secrets/dns-provider-abc-123");
    expect(calls.addSecretVersion[0].payload.data.toString("utf8")).toBe("the-token");
  });

  it("never puts the value in the create request, only in the version payload", async () => {
    mutableEnv.SECRET_MANAGER_PROJECT = "test-project";
    const { client, calls } = fakeGoogle();
    await new GcpSecretManagerStore(client).set("connector-oauth/x", "super-secret-value");
    expect(JSON.stringify(calls.createSecret)).not.toContain("super-secret-value");
  });

  it("still adds a new version when the secret already exists", async () => {
    mutableEnv.SECRET_MANAGER_PROJECT = "test-project";
    const { client, calls } = fakeGoogle({ existing: true });
    await expect(new GcpSecretManagerStore(client).set("dns-provider/abc-123", "rotated")).resolves.toBeUndefined();
    expect(calls.addSecretVersion).toHaveLength(1);
  });

  it("does not hide a real failure, such as a missing permission", async () => {
    mutableEnv.SECRET_MANAGER_PROJECT = "test-project";
    const { client, calls } = fakeGoogle({ createError: { code: 7 } });
    await expect(new GcpSecretManagerStore(client).set("dns-provider/abc-123", "x")).rejects.toThrow(/create refused/);
    expect(calls.addSecretVersion).toHaveLength(0);
  });

  it("reads back through the same store", async () => {
    mutableEnv.SECRET_MANAGER_PROJECT = "test-project";
    const { client } = fakeGoogle();
    await expect(new GcpSecretManagerStore(client).get("dns-provider/abc-123")).resolves.toBe("stored-value");
  });
});
