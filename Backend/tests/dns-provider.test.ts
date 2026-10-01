import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { clearSecretCache, getSecret } from "../src/common/secrets/secrets.js";
import { domainService } from "../src/modules/domain/domain.service.js";
import { runDueDomainSyncs } from "../src/modules/domain/domain.sync.js";
import { mergeSpfInclude, removeSpfInclude } from "../src/modules/domain/dns.publisher.js";
import { DnsProviderError, setDnsProviderAdapter, type DnsProviderAdapter } from "../src/modules/domain/providers/index.js";
import { cloudflareAdapter } from "../src/modules/domain/providers/cloudflare.js";
import { godaddyAdapter } from "../src/modules/domain/providers/godaddy.js";
import { authHeader, registerUser, stepUpHeader } from "./helpers.js";
import { FakeDns } from "./dns-fakes.js";

/**
 * Publishing through a DNS host's API.
 *
 * The fake provider writes into the same in-memory DNS the verifier reads,
 * so these tests cover the whole automated path: connect a credential, add a
 * domain, watch the records appear in DNS, and see them verify — plus the
 * ways that path must not damage what the customer already had.
 */

const app = createApp();
const dns = new FakeDns();
const calls: string[] = [];
let restoreAdapter: () => void;
let restoreLookup: () => void;

beforeEach(() => {
  dns.clear();
  calls.length = 0;
  restoreAdapter = setDnsProviderAdapter("CLOUDFLARE", dns.adapter({ calls }));
  restoreLookup = domainService.setLookupFactory(() => dns.lookup());
});
afterEach(() => {
  restoreAdapter();
  restoreLookup();
  vi.unstubAllGlobals();
});

async function ownerWithCredential(email: string) {
  const owner = await registerUser(app, { email });
  const res = await request(app)
    .post("/api/v1/domains/dns-providers")
    .set(authHeader(owner.accessToken))
    .set(await stepUpHeader(app, owner.accessToken))
    .send({ provider: "CLOUDFLARE", label: "Acme Cloudflare", apiToken: "cf-token-0123456789abcdef" })
    .expect(201);
  return { owner, credential: res.body.data as { id: string } };
}

async function addDomain(accessToken: string, credentialId: string, domainName: string) {
  const res = await request(app)
    .post("/api/v1/domains")
    .set(authHeader(accessToken))
    .send({ domainName, dnsProvider: "CLOUDFLARE", dnsCredentialId: credentialId })
    .expect(201);
  return res.body.data;
}

describe("SPF merging", () => {
  it("adds the include before the terminator, once", () => {
    expect(mergeSpfInclude("v=spf1 include:_spf.google.com ~all", "_spf.zoikomail.test")).toBe("v=spf1 include:_spf.google.com include:_spf.zoikomail.test ~all");
    expect(mergeSpfInclude("v=spf1 mx", "_spf.zoikomail.test")).toBe("v=spf1 mx include:_spf.zoikomail.test");
    expect(mergeSpfInclude("v=spf1 include:_spf.zoikomail.test -all", "_spf.zoikomail.test")).toBe("v=spf1 include:_spf.zoikomail.test -all");
  });

  it("takes it back out, deleting a record that was only ours", () => {
    expect(removeSpfInclude("v=spf1 include:_spf.google.com include:_spf.zoikomail.test ~all", "_spf.zoikomail.test")).toBe("v=spf1 include:_spf.google.com ~all");
    expect(removeSpfInclude("v=spf1 include:_spf.zoikomail.test ~all", "_spf.zoikomail.test")).toBeNull();
  });
});

describe("DNS provider credentials", () => {
  it("need step-up, are proved before storing, and are never returned", async () => {
    const owner = await registerUser(app, { email: "dnsp-connect-owner@zoiko.test" });
    const body = { provider: "CLOUDFLARE", label: "Main", apiToken: "cf-token-0123456789abcdef" };

    const refused = await request(app).post("/api/v1/domains/dns-providers").set(authHeader(owner.accessToken)).send(body).expect(403);
    expect(refused.body.error.details?.requiresStepUp).toBe(true);

    const res = await request(app)
      .post("/api/v1/domains/dns-providers")
      .set(authHeader(owner.accessToken))
      .set(await stepUpHeader(app, owner.accessToken))
      .send(body)
      .expect(201);
    expect(calls).toContain("verify");
    expect(res.body.data).toMatchObject({ provider: "CLOUDFLARE", label: "Main", status: "ACTIVE" });
    expect(JSON.stringify(res.body)).not.toContain(body.apiToken);
    expect(JSON.stringify(res.body)).not.toContain("secretRef");

    const row = await prisma.dnsProviderCredential.findFirstOrThrow({ where: { tenantId: owner.tenantId } });
    expect(JSON.parse(await getSecret(row.secretRef, { purpose: "test" }))).toEqual({ provider: "CLOUDFLARE", apiToken: body.apiToken });

    const listed = await request(app).get("/api/v1/domains/dns-providers").set(authHeader(owner.accessToken)).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(body.apiToken);

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId: owner.tenantId, eventType: "DNS_PROVIDER_CONNECTED" } });
    expect(JSON.stringify(audit.metadata)).not.toContain(body.apiToken);
  });

  it("reports a credential the provider rejects as the provider's error", async () => {
    restoreAdapter();
    restoreAdapter = setDnsProviderAdapter("CLOUDFLARE", dns.adapter({ rejectCredential: true }));
    const owner = await registerUser(app, { email: "dnsp-reject-owner@zoiko.test" });
    const res = await request(app)
      .post("/api/v1/domains/dns-providers")
      .set(authHeader(owner.accessToken))
      .set(await stepUpHeader(app, owner.accessToken))
      .send({ provider: "CLOUDFLARE", label: "Bad", apiToken: "cf-token-0123456789abcdef" })
      .expect(422);
    expect(res.body.error.code).toBe("DNS_PROVIDER_ERROR");
    expect(await prisma.dnsProviderCredential.count({ where: { tenantId: owner.tenantId } })).toBe(0);
  });

  it("cannot be removed while a domain publishes through it", async () => {
    const { owner, credential } = await ownerWithCredential("dnsp-inuse-owner@zoiko.test");
    const domain = await addDomain(owner.accessToken, credential.id, "inuse.example.test");
    const row = await prisma.dnsProviderCredential.findUniqueOrThrow({ where: { id: credential.id } });

    const blocked = await request(app).delete(`/api/v1/domains/dns-providers/${credential.id}`)
      .set(authHeader(owner.accessToken)).set(await stepUpHeader(app, owner.accessToken)).expect(409);
    expect(blocked.body.error.message).toContain("inuse.example.test");

    await request(app).patch(`/api/v1/domains/${domain.id}`).set(authHeader(owner.accessToken)).send({ dnsProvider: "MANUAL" }).expect(200);
    await request(app).delete(`/api/v1/domains/dns-providers/${credential.id}`)
      .set(authHeader(owner.accessToken)).set(await stepUpHeader(app, owner.accessToken)).expect(200);
    clearSecretCache();
    await expect(getSecret(row.secretRef, { purpose: "test" })).rejects.toThrow(/Secret not available/);
  });
});

describe("automatic publishing", () => {
  it("publishes a new domain's records beside what is there, then verifies them", async () => {
    const { owner, credential } = await ownerWithCredential("dnsp-publish-owner@zoiko.test");
    const name = "publish.example.test";
    dns.add("TXT", name, "google-site-verification=keep-me");
    dns.add("TXT", name, "v=spf1 include:_spf.google.com ~all");
    dns.add("MX", name, "aspmx.l.google.com", 1);

    const domain = await addDomain(owner.accessToken, credential.id, name);
    expect(domain.records.every((entry: { publishState: string }) => entry.publishState === "PUBLISHED")).toBe(true);

    const apex = dns.get("TXT", name).map((value) => value.content);
    expect(apex).toContain("google-site-verification=keep-me");
    expect(apex).toContain(domain.verificationToken);
    // One SPF record, merged — never a second one.
    expect(apex.filter((value) => value.startsWith("v=spf1"))).toEqual(["v=spf1 include:_spf.google.com include:_spf.zoikomail.test ~all"]);
    // The existing mail host is not removed without being asked.
    expect(dns.get("MX", name).map((value) => value.content)).toEqual(["aspmx.l.google.com", "mx1.zoikomail.test", "mx2.zoikomail.test"]);

    let result = (await request(app).post(`/api/v1/domains/${domain.id}/diagnostics`).set(authHeader(owner.accessToken)).expect(200)).body.data;
    // Sending needs no MX; receiving still goes to Google first, and says so.
    expect(result).toMatchObject({ status: "ACTIVE", sendingEnabled: true, spfStatus: "VALID", dkimStatus: "VALID", mxStatus: "INVALID" });
    const mx = result.records.find((entry: { recordKey: string }) => entry.recordKey === "MX:mx1.zoikomail.test");
    expect(mx.state).toBe("CONFLICT");
    expect(mx.diagnosis).toMatch(/aspmx\.l\.google\.com/);

    // Taking over inbound mail is an explicit decision, and republishes MX.
    await request(app).patch(`/api/v1/domains/${domain.id}`).set(authHeader(owner.accessToken)).send({ replaceExistingMx: true }).expect(200);
    expect(dns.get("MX", name).map((value) => value.content)).toEqual(["mx1.zoikomail.test", "mx2.zoikomail.test"]);
    result = (await request(app).post(`/api/v1/domains/${domain.id}/diagnostics`).set(authHeader(owner.accessToken)).expect(200)).body.data;
    expect(result).toMatchObject({ mxStatus: "VALID", readiness: { fullyReady: true } });
  });

  it("keeps a DMARC policy the owner already publishes", async () => {
    const { owner, credential } = await ownerWithCredential("dnsp-dmarc-owner@zoiko.test");
    dns.add("TXT", "_dmarc.dmarc.example.test", "v=DMARC1; p=reject; rua=mailto:sec@dmarc.example.test");
    const domain = await addDomain(owner.accessToken, credential.id, "dmarc.example.test");
    expect(dns.get("TXT", "_dmarc.dmarc.example.test").map((value) => value.content)).toEqual(["v=DMARC1; p=reject; rua=mailto:sec@dmarc.example.test"]);

    const result = (await request(app).post(`/api/v1/domains/${domain.id}/diagnostics`).set(authHeader(owner.accessToken)).expect(200)).body.data;
    const dmarc = result.records.find((entry: { purpose: string }) => entry.purpose === "DMARC");
    expect(dmarc.state).toBe("VERIFIED");
    expect(dmarc.diagnosis).toMatch(/p=reject/);
  });

  it("refuses to guess between two SPF records that already exist", async () => {
    const { owner, credential } = await ownerWithCredential("dnsp-spf-owner@zoiko.test");
    dns.add("TXT", "spf.example.test", "v=spf1 include:a.test ~all");
    dns.add("TXT", "spf.example.test", "v=spf1 include:b.test ~all");
    const domain = await addDomain(owner.accessToken, credential.id, "spf.example.test");
    const spf = domain.records.find((entry: { purpose: string }) => entry.purpose === "SPF");
    expect(spf.publishState).toBe("FAILED");
    expect(spf.publishError).toMatch(/several SPF records/);
    expect(dns.get("TXT", "spf.example.test")).toHaveLength(3);
  });

  it("re-asserts records someone deleted by hand", async () => {
    const { owner, credential } = await ownerWithCredential("dnsp-repair-owner@zoiko.test");
    const domain = await addDomain(owner.accessToken, credential.id, "repair.example.test");
    const dkim = domain.records.find((entry: { purpose: string }) => entry.purpose === "DKIM");
    dns.set("TXT", dkim.fqdn, []);

    const res = await request(app).post(`/api/v1/domains/${domain.id}/publish`).set(authHeader(owner.accessToken)).expect(200);
    expect(res.body.data.publishResult.published).toContain(dkim.recordKey);
    expect(dns.get("TXT", dkim.fqdn).map((value) => value.content)).toEqual([dkim.value]);
  });

  it("marks records failed when the provider is down, and the scheduler retries", async () => {
    const { owner, credential } = await ownerWithCredential("dnsp-outage-owner@zoiko.test");
    restoreAdapter();
    const down: DnsProviderAdapter = {
      verify: async () => ({ account: null }),
      connect: async () => { throw new DnsProviderError("The DNS provider did not respond in time"); },
    };
    restoreAdapter = setDnsProviderAdapter("CLOUDFLARE", down);

    const domain = await addDomain(owner.accessToken, credential.id, "outage.example.test");
    expect(domain.records.every((entry: { publishState: string }) => entry.publishState === "FAILED")).toBe(true);
    expect(domain.lastSyncError).toMatch(/did not respond/);

    restoreAdapter();
    restoreAdapter = setDnsProviderAdapter("CLOUDFLARE", dns.adapter());
    await prisma.mailDomain.update({ where: { id: domain.id }, data: { nextCheckAt: new Date(Date.now() - 1000) } });
    expect(await runDueDomainSyncs()).toMatchObject({ claimed: 1, synchronized: 1 });

    const row = await prisma.mailDomain.findUniqueOrThrow({ where: { id: domain.id }, include: { records: true } });
    expect(row.records.every((entry) => entry.publishState === "PUBLISHED")).toBe(true);
    expect(row).toMatchObject({ lastSyncError: null, status: "ACTIVE" });
  });

  it("takes its records back out of DNS when the domain is removed", async () => {
    const { owner, credential } = await ownerWithCredential("dnsp-remove-owner@zoiko.test");
    const name = "remove.example.test";
    dns.add("TXT", name, "v=spf1 include:_spf.google.com ~all");
    const domain = await addDomain(owner.accessToken, credential.id, name);
    const dkim = domain.records.find((entry: { purpose: string }) => entry.purpose === "DKIM");

    await request(app).delete(`/api/v1/domains/${domain.id}`)
      .set(authHeader(owner.accessToken)).set(await stepUpHeader(app, owner.accessToken)).expect(200);

    expect(dns.get("TXT", name).map((value) => value.content)).toEqual(["v=spf1 include:_spf.google.com ~all"]);
    expect(dns.get("TXT", dkim.fqdn)).toEqual([]);
    expect(dns.get("TXT", `_dmarc.${name}`)).toEqual([]);
    expect(dns.get("MX", name)).toEqual([]);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId: owner.tenantId, eventType: "DOMAIN_DNS_UNPUBLISHED" } });
    expect(audit.metadata).toMatchObject({ reason: "Domain removed", failed: [] });
  });
});

describe("provider HTTP adapters", () => {
  function stubFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
    const seen: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      seen.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null, headers: init.headers as Record<string, string> });
      const { status = 200, body } = handler(url, init);
      return new Response(body === null ? null : JSON.stringify(body), { status });
    });
    return seen;
  }
  const cf = <T>(result: T) => ({ body: { success: true, errors: [], result } });

  it("Cloudflare: finds the zone for a subdomain and replaces the value set", async () => {
    const seen = stubFetch((url, init) => {
      if (url.includes("/zones?name=mail.acme.test")) return cf([]);
      if (url.includes("/zones?name=acme.test")) return cf([{ id: "z1", name: "acme.test" }]);
      if (url.includes("/dns_records?type=TXT")) return cf([{ id: "r1", type: "TXT", name: "mail.acme.test", content: '"keep"' }, { id: "r2", type: "TXT", name: "mail.acme.test", content: '"drop"' }]);
      if (init.method === "DELETE" || init.method === "POST") return cf({});
      return { status: 404, body: { success: false, errors: [{ code: 1, message: "unexpected" }] } };
    });
    const zone = await cloudflareAdapter.connect({ provider: "CLOUDFLARE", apiToken: "t" }, {}, "mail.acme.test");
    expect(zone.zone).toBe("acme.test");
    expect(await zone.get("TXT", "mail.acme.test")).toEqual([{ content: "keep", priority: null }, { content: "drop", priority: null }]);

    await zone.set("TXT", "mail.acme.test", [{ content: "keep" }, { content: "new" }], 3600);
    expect(seen.filter((call) => call.method === "DELETE").map((call) => call.url)).toEqual([expect.stringContaining("/dns_records/r2")]);
    expect(seen.find((call) => call.method === "POST")!.body).toEqual({ type: "TXT", name: "mail.acme.test", content: '"new"', ttl: 3600 });
    expect(seen[0]!.headers.Authorization).toBe("Bearer t");
  });

  it("Cloudflare: explains a rejected token", async () => {
    stubFetch(() => ({ status: 403, body: { success: false, errors: [{ code: 9109, message: "Invalid access token" }] } }));
    await expect(cloudflareAdapter.verify({ provider: "CLOUDFLARE", apiToken: "bad" }, {})).rejects.toThrow(/DNS:Edit/);
  });

  it("GoDaddy: addresses records relative to the zone, with its minimum TTL", async () => {
    const seen = stubFetch((url, init) => {
      if (url.endsWith("/v1/domains/acme.test") && !init.method) return { body: { domain: "acme.test" } };
      if (init.method === "PUT") return { body: null };
      if (init.method === "DELETE") return { status: 404, body: { message: "not found" } };
      return { body: [{ data: "v=DMARC1; p=none", name: "_dmarc", type: "TXT", ttl: 600 }] };
    });
    const zone = await godaddyAdapter.connect({ provider: "GODADDY", apiKey: "k", apiSecret: "s" }, { environment: "OTE" }, "acme.test");
    expect(await zone.get("TXT", "_dmarc.acme.test")).toEqual([{ content: "v=DMARC1; p=none", priority: null }]);

    await zone.set("MX", "acme.test", [{ content: "mx1.zoikomail.test", priority: 10 }], 300);
    const put = seen.find((call) => call.method === "PUT")!;
    expect(put.url).toBe("https://api.ote-godaddy.com/v1/domains/acme.test/records/MX/%40");
    expect(put.body).toEqual([{ data: "mx1.zoikomail.test", ttl: 600, priority: 10 }]);
    expect(put.headers.Authorization).toBe("sso-key k:s");

    // Deleting something already gone is not an error.
    await expect(zone.set("TXT", "zm1._domainkey.acme.test", [], 600)).resolves.toBeUndefined();
  });

  it("GoDaddy: says when the account has no API access", async () => {
    stubFetch(() => ({ status: 403, body: { code: "ACCESS_DENIED", message: "Authenticated user is not allowed access" } }));
    await expect(godaddyAdapter.verify({ provider: "GODADDY", apiKey: "k", apiSecret: "s" }, {})).rejects.toThrow(/account types/);
  });
});
