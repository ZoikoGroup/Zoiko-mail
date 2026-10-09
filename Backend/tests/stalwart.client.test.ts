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
      credentials: [{ "@type": "Password", secret: "initial-secret" }],
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
