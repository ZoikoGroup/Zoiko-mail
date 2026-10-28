import { describe, expect, it } from "vitest";
import { StalwartClient } from "../src/modules/stalwart/stalwart.client.js";
import { StalwartError } from "../src/modules/stalwart/stalwart.types.js";

/**
 * The client against a controlled fake of Stalwart's v0.16 JMAP management
 * API. The fake follows the documented contract (session object with the
 * `urn:stalwart:jmap` capability, `x:Account/*` and `x:Domain/*` methods,
 * RFC 8620 set/get shapes) — it never reaches a real server.
 */

const BASE = "https://mail.example.test";
const TOKEN = "test-api-key-not-a-real-secret";

interface Recorded {
  url: string;
  method: string;
  authorization: string | null;
  body: any;
}

type Handler = (body: any) => { status?: number; json: unknown };

function fakeServer(handler: Handler, session: Record<string, unknown> = {}) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init?.method ?? "GET", authorization: headers.get("authorization"), body });
    if (url === `${BASE}/jmap/session`) {
      return new Response(
        JSON.stringify({
          capabilities: { "urn:ietf:params:jmap:core": {}, "urn:stalwart:jmap": {} },
          apiUrl: `${BASE}/jmap/`,
          primaryAccounts: { "urn:stalwart:jmap": "sys" },
          ...session,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    const result = handler(body);
    return new Response(JSON.stringify(result.json), { status: result.status ?? 200 });
  }) as typeof fetch;
  const client = new StalwartClient({ fetch: fetchImpl, token: async () => TOKEN, baseUrl: BASE, enabled: true });
  return { client, calls };
}

const account = {
  id: "acc1",
  name: "john",
  domainId: "dom1",
  emailAddress: "john@acme.test",
  description: "zoiko:mailbox:123",
  quotas: { maxDiskQuota: 5368709120 },
};

describe("StalwartClient", () => {
  it("creates an account with the documented shape and verifies it by reading it back", async () => {
    const { client, calls } = fakeServer((body) => {
      const [method, args] = body.methodCalls[0];
      if (method === "x:Account/set") return { json: { methodResponses: [["x:Account/set", { created: { a: { id: "acc1" } } }, "s"]] } };
      if (method === "x:Account/get") {
        expect(args.ids).toEqual(["acc1"]);
        return { json: { methodResponses: [["x:Account/get", { list: [account] }, "g"]] } };
      }
      throw new Error(`unexpected ${method}`);
    });

    const created = await client.createAccount({
      name: "John",
      domainId: "dom1",
      secret: "initial-secret",
      diskQuotaBytes: 5368709120,
      description: "zoiko:mailbox:123",
    });

    expect(created).toMatchObject({ id: "acc1", emailAddress: "john@acme.test", diskQuotaBytes: 5368709120 });
    const setCall = calls.find((c) => c.body?.methodCalls?.[0]?.[0] === "x:Account/set")!;
    expect(setCall.url).toBe(`${BASE}/jmap/`);
    expect(setCall.authorization).toBe(`Bearer ${TOKEN}`);
    expect(setCall.body.using).toEqual(["urn:ietf:params:jmap:core", "urn:stalwart:jmap"]);
    const args = setCall.body.methodCalls[0][1];
    // accountId comes from the session's primaryAccounts, not a guess.
    expect(args.accountId).toBe("sys");
    expect(args.create.a).toMatchObject({
      "@type": "User",
      name: "john",
      domainId: "dom1",
      // A map keyed by a number-like id: v0.16.25 refuses an array.
      credentials: { "0": { "@type": "Password", secret: "initial-secret" } },
      roles: { "@type": "User" },
      quotas: { maxDiskQuota: 5368709120 },
    });
  });

  it("omits accountId when the session does not name one", async () => {
    const { client, calls } = fakeServer(
      () => ({ json: { methodResponses: [["x:Domain/query", { ids: [] }, "q"], ["x:Domain/get", { list: [] }, "g"]] } }),
      { primaryAccounts: {} }
    );
    expect(await client.findDomain("acme.test")).toBeNull();
    const call = calls.find((c) => c.method === "POST")!;
    expect("accountId" in call.body.methodCalls[0][1]).toBe(false);
  });

  it("matches a domain exactly even though the name filter is a text search", async () => {
    const { client } = fakeServer(() => ({
      json: {
        methodResponses: [
          ["x:Domain/query", { ids: ["d1", "d2"] }, "q"],
          ["x:Domain/get", { list: [{ id: "d1", name: "sub.acme.test" }, { id: "d2", name: "acme.test" }] }, "g"],
        ],
      },
    }));
    expect(await client.findDomain("ACME.test")).toEqual({ id: "d2", name: "acme.test" });
  });

  it("maps a duplicate SetError to ALREADY_EXISTS", async () => {
    const { client } = fakeServer(() => ({
      json: { methodResponses: [["x:Account/set", { notCreated: { a: { type: "primaryKeyViolation" } } }, "s"]] },
    }));
    await expect(
      client.createAccount({ name: "john", domainId: "dom1", secret: "x", diskQuotaBytes: 1, description: "d" })
    ).rejects.toMatchObject({ code: "ALREADY_EXISTS", retryable: false });
  });

  it("maps HTTP failures to codes without leaking the response body", async () => {
    for (const [status, code, retryable] of [
      [401, "AUTH_FAILED", false],
      [403, "FORBIDDEN", false],
      [429, "RATE_LIMITED", true],
      [503, "UNAVAILABLE", true],
    ] as const) {
      const { client } = fakeServer(() => ({ status, json: { detail: "secret-internal-detail" } }));
      const error = await client.findDomain("acme.test").catch((e) => e);
      expect(error).toBeInstanceOf(StalwartError);
      expect(error).toMatchObject({ code, retryable });
      expect(String(error.message)).not.toContain("secret-internal-detail");
    }
  });

  it("maps a method-level forbidden error", async () => {
    const { client } = fakeServer(() => ({ json: { methodResponses: [["error", { type: "forbidden" }, "q"]] } }));
    await expect(client.findAccount("john", "dom1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a server without the management capability", async () => {
    const { client } = fakeServer(() => ({ json: {} }), { capabilities: { "urn:ietf:params:jmap:core": {} } });
    await expect(client.findDomain("acme.test")).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });

  it("still refuses when no account carries the management capability either", async () => {
    const { client, calls } = fakeServer(() => ({ json: {} }), {
      capabilities: { "urn:ietf:params:jmap:core": {} },
      primaryAccounts: {},
      accounts: { b: { name: "admin", accountCapabilities: { "urn:ietf:params:jmap:mail": {} } } },
    });
    await expect(client.findDomain("acme.test")).rejects.toMatchObject({ code: "NOT_SUPPORTED", retryable: false });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("does not follow an apiUrl on another origin", async () => {
    const { client, calls } = fakeServer(
      () => ({ json: { methodResponses: [["x:Domain/query", { ids: [] }, "q"], ["x:Domain/get", { list: [] }, "g"]] } }),
      { apiUrl: "https://attacker.example/jmap/" }
    );
    await client.findDomain("acme.test");
    expect(calls.every((c) => c.url.startsWith(BASE))).toBe(true);
  });

  it("treats a timeout as retryable", async () => {
    const fetchImpl = (async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof fetch;
    const client = new StalwartClient({ fetch: fetchImpl, token: async () => TOKEN, baseUrl: BASE, enabled: true });
    await expect(client.findDomain("acme.test")).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("refuses to run when not configured", async () => {
    const client = new StalwartClient({ enabled: false, baseUrl: BASE, token: async () => TOKEN });
    expect(client.isConfigured()).toBe(false);
    await expect(client.findDomain("acme.test")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("probe reports a rejected key as reachable but unauthenticated", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const client = new StalwartClient({ fetch: fetchImpl, token: async () => TOKEN, baseUrl: BASE, enabled: true });
    expect(await client.probe()).toEqual({ reachable: true, authenticated: false, managementCapability: false });
  });
});

/**
 * The session as Stalwart v0.16.25 serves it: `urn:stalwart:jmap` is not in
 * the top-level capabilities and has no primary account — it is advertised
 * only in the account's `accountCapabilities`.
 */
const V0_16_25_SESSION = {
  capabilities: {
    "urn:ietf:params:jmap:core": { maxSizeUpload: 50000000, maxCallsInRequest: 16 },
    "urn:ietf:params:jmap:mail": {},
    "urn:ietf:params:jmap:submission": {},
  },
  accounts: {
    b: {
      name: "admin",
      isPersonal: true,
      isReadOnly: false,
      accountCapabilities: {
        "urn:ietf:params:jmap:mail": {},
        "urn:ietf:params:jmap:submission": {},
        "urn:stalwart:jmap": {},
      },
    },
  },
  primaryAccounts: { "urn:ietf:params:jmap:mail": "b", "urn:ietf:params:jmap:submission": "b" },
};

describe("StalwartClient against a v0.16.25 session", () => {
  it("finds the management capability on the account and runs calls against that account", async () => {
    const { client, calls } = fakeServer(
      () => ({ json: { methodResponses: [["x:Domain/query", { ids: ["d1"] }, "q"], ["x:Domain/get", { list: [{ id: "d1", name: "temveris.com" }] }, "g"]] } }),
      V0_16_25_SESSION
    );
    expect(await client.findDomain("temveris.com")).toEqual({ id: "d1", name: "temveris.com" });
    const call = calls.find((c) => c.method === "POST")!;
    expect(call.body.using).toEqual(["urn:ietf:params:jmap:core", "urn:stalwart:jmap"]);
    expect(call.body.methodCalls[0][1].accountId).toBe("b");
  });

  it("picks the account that carries the capability, not just the first one listed", async () => {
    const { client, calls } = fakeServer(
      () => ({ json: { methodResponses: [["x:Domain/query", { ids: [] }, "q"], ["x:Domain/get", { list: [] }, "g"]] } }),
      {
        ...V0_16_25_SESSION,
        accounts: { a: { name: "shared", accountCapabilities: { "urn:ietf:params:jmap:mail": {} } }, ...V0_16_25_SESSION.accounts },
      }
    );
    await client.findDomain("temveris.com");
    expect(calls.find((c) => c.method === "POST")!.body.methodCalls[0][1].accountId).toBe("b");
  });

  it("still prefers a primary account the session names for the capability", async () => {
    const { client, calls } = fakeServer(
      () => ({ json: { methodResponses: [["x:Domain/query", { ids: [] }, "q"], ["x:Domain/get", { list: [] }, "g"]] } }),
      { ...V0_16_25_SESSION, primaryAccounts: { ...V0_16_25_SESSION.primaryAccounts, "urn:stalwart:jmap": "sys" } }
    );
    await client.findDomain("temveris.com");
    expect(calls.find((c) => c.method === "POST")!.body.methodCalls[0][1].accountId).toBe("sys");
  });

  it("creates an account end to end", async () => {
    const { client, calls } = fakeServer((body) => {
      const [method] = body.methodCalls[0];
      if (method === "x:Account/set") return { json: { methodResponses: [["x:Account/set", { created: { a: { id: "acc1" } } }, "s"]] } };
      return { json: { methodResponses: [["x:Account/get", { list: [account] }, "g"]] } };
    }, V0_16_25_SESSION);
    await expect(
      client.createAccount({ name: "info", domainId: "dom1", secret: "x", diskQuotaBytes: 1, description: "d" })
    ).resolves.toMatchObject({ id: "acc1" });
    expect(calls.filter((c) => c.method === "POST").every((c) => c.body.methodCalls[0][1].accountId === "b")).toBe(true);
  });

  it("assigns the User role by default, or the configured custom role", async () => {
    const created = (accountRoleId: string | null) => {
      const calls: any[] = [];
      const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/jmap/session")) return new Response(JSON.stringify(V0_16_25_SESSION));
        const body = JSON.parse(String(init!.body));
        calls.push(body);
        const method = body.methodCalls[0][0];
        const json = method === "x:Account/set"
          ? { methodResponses: [["x:Account/set", { created: { a: { id: "acc1" } } }, "s"]] }
          : { methodResponses: [["x:Account/get", { list: [account] }, "g"]] };
        return new Response(JSON.stringify(json));
      }) as typeof fetch;
      const client = new StalwartClient({ fetch: fetchImpl, token: async () => TOKEN, baseUrl: BASE, enabled: true, accountRoleId });
      return client
        .createAccount({ name: "info", domainId: "dom1", secret: "x", diskQuotaBytes: 1, description: "d" })
        .then(() => calls[0].methodCalls[0][1].create.a.roles);
    };
    expect(await created(null)).toEqual({ "@type": "User" });
    expect(await created("g")).toEqual({ "@type": "Custom", roleIds: { g: true } });
  });

  it("probe reports the management capability", async () => {
    const { client } = fakeServer(() => ({ json: {} }), V0_16_25_SESSION);
    expect(await client.probe()).toEqual({ reachable: true, authenticated: true, managementCapability: true });
  });

  it("replaces the password with credentials as a map keyed by a number-like id", async () => {
    const { client, calls } = fakeServer(
      () => ({ json: { methodResponses: [["x:Account/set", { updated: { acc1: null } }, "s"]] } }),
      V0_16_25_SESSION
    );
    await client.setAccountPassword("acc1", "new-secret");
    const args = calls.find((c) => c.method === "POST")!.body.methodCalls[0][1];
    expect(args).toMatchObject({ accountId: "b", update: { acc1: { credentials: { "0": { "@type": "Password", secret: "new-secret" } } } } });
    expect(Array.isArray(args.update.acc1.credentials)).toBe(false);
  });

  it("keeps Stalwart's type, description and properties on a refused create, without the password", async () => {
    const { client } = fakeServer(
      () => ({
        json: {
          methodResponses: [
            [
              "x:Account/set",
              { notCreated: { a: { type: "invalidPatch", description: "Invalid value \"initial-secret\"", properties: ["credentials"] } } },
              "s",
            ],
          ],
        },
      }),
      V0_16_25_SESSION
    );
    const error = await client
      .createAccount({ name: "info", domainId: "dom1", secret: "initial-secret", diskQuotaBytes: 1, description: "d" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(StalwartError);
    expect(error).toMatchObject({ code: "INVALID_REQUEST", jmapType: "invalidPatch", detail: { properties: ["credentials"] } });
    expect(error.detail.description).toBe("Invalid value \"[redacted]\"");
    expect(JSON.stringify(error)).not.toContain("initial-secret");
  });

  it("keeps the detail of a refused password change, without the password", async () => {
    const { client } = fakeServer(
      () => ({
        json: { methodResponses: [["x:Account/set", { notUpdated: { acc1: { type: "invalidPatch", description: "Invalid key: new-secret" } } }, "s"]] },
      }),
      V0_16_25_SESSION
    );
    const error = await client.setAccountPassword("acc1", "new-secret").catch((e) => e);
    expect(error).toMatchObject({ code: "INVALID_REQUEST", jmapType: "invalidPatch", detail: { description: "Invalid key: [redacted]" } });
  });

  it("keeps the description of a method-level error, bounded", async () => {
    const { client } = fakeServer(
      () => ({ json: { methodResponses: [["error", { type: "invalidArguments", description: `bad\n${"x".repeat(2000)}` }, "q"]] } }),
      V0_16_25_SESSION
    );
    const error = await client.findDomain("temveris.com").catch((e) => e);
    expect(error).toMatchObject({ code: "INVALID_REQUEST", jmapType: "invalidArguments" });
    expect(error.detail.description.startsWith("bad x")).toBe(true);
    expect(error.detail.description.length).toBe(500);
  });

  it("maps unknownCapability and unknownMethod from the method call to NOT_SUPPORTED", async () => {
    const http = fakeServer(() => ({ status: 400, json: { type: "urn:ietf:params:jmap:error:unknownCapability" } }), V0_16_25_SESSION);
    await expect(http.client.findDomain("temveris.com")).rejects.toMatchObject({ code: "NOT_SUPPORTED", retryable: false });
    const method = fakeServer(() => ({ json: { methodResponses: [["error", { type: "unknownMethod" }, "q"]] } }), V0_16_25_SESSION);
    await expect(method.client.findDomain("temveris.com")).rejects.toMatchObject({ code: "NOT_SUPPORTED", retryable: false });
  });
});

const MAIL_SESSION = {
  capabilities: { "urn:ietf:params:jmap:core": {}, "urn:ietf:params:jmap:mail": {}, "urn:stalwart:jmap": {} },
  accounts: { acc1: { name: "john", isPersonal: false } },
};

const countResponse = (over: Record<string, unknown> = {}) => ({
  json: { methodResponses: [["Email/query", { accountId: "acc1", total: 0, ids: [], ...over }, "c"]] },
});

describe("StalwartClient.countMessages", () => {
  it("returns the total the server reports for exactly that account", async () => {
    const { client, calls } = fakeServer(() => countResponse({ total: 42 }), MAIL_SESSION);
    expect(await client.countMessages("acc1")).toBe(42);
    const call = calls.find((c) => c.method === "POST")!;
    expect(call.body.using).toEqual(["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"]);
    expect(call.body.methodCalls[0][0]).toBe("Email/query");
    expect(call.body.methodCalls[0][1]).toMatchObject({ accountId: "acc1", calculateTotal: true });
  });

  it("reads a genuine zero as zero", async () => {
    const { client } = fakeServer(() => countResponse({ total: 0 }), MAIL_SESSION);
    expect(await client.countMessages("acc1")).toBe(0);
  });

  it("fails closed when the session cannot address the account", async () => {
    const { client, calls } = fakeServer(() => countResponse(), { ...MAIL_SESSION, accounts: { other: {} } });
    await expect(client.countMessages("acc1")).rejects.toMatchObject({ code: "COUNT_UNAVAILABLE" });
    // It never even asked: there was nothing to read the answer from.
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("fails closed when the session does not offer the mail capability", async () => {
    const { client } = fakeServer(() => countResponse(), {
      ...MAIL_SESSION,
      capabilities: { "urn:ietf:params:jmap:core": {}, "urn:stalwart:jmap": {} },
    });
    await expect(client.countMessages("acc1")).rejects.toMatchObject({ code: "COUNT_UNAVAILABLE" });
  });

  it("fails closed on every answer it cannot rely on", async () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ["no total", { total: undefined }],
      ["string total", { total: "0" }],
      ["negative total", { total: -1 }],
      ["fractional total", { total: 1.5 }],
      ["null total", { total: null }],
      ["a different account", { accountId: "acc2", total: 0 }],
    ];
    for (const [label, over] of bad) {
      const { client } = fakeServer(() => countResponse(over), MAIL_SESSION);
      const error = await client.countMessages("acc1").catch((e) => e);
      expect(error, label).toBeInstanceOf(StalwartError);
      expect(error.code, label).toBe("COUNT_UNAVAILABLE");
    }
  });

  it("fails closed when the response is not an Email/query answer", async () => {
    const { client } = fakeServer(() => ({ json: { methodResponses: [["Email/get", { accountId: "acc1", list: [] }, "c"]] } }), MAIL_SESSION);
    await expect(client.countMessages("acc1")).rejects.toMatchObject({ code: "COUNT_UNAVAILABLE" });
  });

  it("fails closed on a method-level refusal, whatever the server calls it", async () => {
    for (const type of ["forbidden", "accountNotFound", "accountNotSupportedByMethod", "serverFail"]) {
      const { client } = fakeServer(() => ({ json: { methodResponses: [["error", { type }, "c"]] } }), MAIL_SESSION);
      const error = await client.countMessages("acc1").catch((e) => e);
      expect(error, type).toMatchObject({ code: "COUNT_UNAVAILABLE", jmapType: type });
    }
  });

  it("fails closed on HTTP and transport failures, keeping retryability", async () => {
    for (const [status, retryable] of [[401, false], [403, false], [429, true], [503, true]] as const) {
      const { client } = fakeServer(() => ({ status, json: {} }), MAIL_SESSION);
      await expect(client.countMessages("acc1")).rejects.toMatchObject({ code: "COUNT_UNAVAILABLE", retryable });
    }
    const timeout = (async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof fetch;
    const client = new StalwartClient({ fetch: timeout, token: async () => TOKEN, baseUrl: BASE, enabled: true });
    await expect(client.countMessages("acc1")).rejects.toMatchObject({ code: "COUNT_UNAVAILABLE", retryable: true });
  });

  it("never lets the response body or the credential into the error", async () => {
    const { client } = fakeServer(() => ({ status: 500, json: { detail: "secret-internal-detail" } }), MAIL_SESSION);
    const error = await client.countMessages("acc1").catch((e) => e);
    expect(String(error.message)).not.toContain("secret-internal-detail");
    expect(String(error.message)).not.toContain(TOKEN);
  });
});

describe("StalwartClient.deleteAccount", () => {
  /** A server whose x:Account/set destroy is scripted, and whose get reports what remains. */
  function destroyServer(setResult: Record<string, unknown>, stillThere = false) {
    return fakeServer((body) => {
      const method = body.methodCalls[0][0];
      if (method === "x:Account/set") return { json: { methodResponses: [["x:Account/set", setResult, "d"]] } };
      return { json: { methodResponses: [["x:Account/get", { list: stillThere ? [account] : [] }, "g"]] } };
    });
  }

  it("destroys by id with the documented set shape and confirms by reading it back", async () => {
    const { client, calls } = destroyServer({ destroyed: ["acc1"] });
    expect(await client.deleteAccount("acc1")).toBe("DELETED");
    const set = calls.filter((c) => c.method === "POST")[0]!;
    expect(set.body.using).toEqual(["urn:ietf:params:jmap:core", "urn:stalwart:jmap"]);
    expect(set.body.methodCalls[0][0]).toBe("x:Account/set");
    expect(set.body.methodCalls[0][1]).toMatchObject({ destroy: ["acc1"] });
    // The read-back is part of the contract: success is an account that is absent.
    expect(calls.filter((c) => c.method === "POST")[1]!.body.methodCalls[0][0]).toBe("x:Account/get");
  });

  it("treats notFound as already gone", async () => {
    const { client } = destroyServer({ notDestroyed: { acc1: { type: "notFound" } } });
    expect(await client.deleteAccount("acc1")).toBe("ALREADY_ABSENT");
  });

  it("refuses to report success for an account that is still there", async () => {
    const { client } = destroyServer({ destroyed: ["acc1"] }, true);
    await expect(client.deleteAccount("acc1")).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE", retryable: true });
  });

  it("maps a refusal to a non-retryable code, forbidden included", async () => {
    const forbidden = destroyServer({ notDestroyed: { acc1: { type: "forbidden" } } });
    await expect(forbidden.client.deleteAccount("acc1")).rejects.toMatchObject({ code: "FORBIDDEN", retryable: false });
    const other = destroyServer({ notDestroyed: { acc1: { type: "invalidProperties" } } });
    await expect(other.client.deleteAccount("acc1")).rejects.toMatchObject({ code: "INVALID_REQUEST", retryable: false });
  });

  it("does not take silence for success", async () => {
    for (const result of [{}, { destroyed: [] }, { destroyed: ["someone-else"] }, { notDestroyed: {} }]) {
      const { client } = destroyServer(result);
      await expect(client.deleteAccount("acc1")).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE", retryable: true });
    }
  });

  it("maps a method-level forbidden error", async () => {
    const { client } = fakeServer(() => ({ json: { methodResponses: [["error", { type: "forbidden" }, "d"]] } }));
    await expect(client.deleteAccount("acc1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
