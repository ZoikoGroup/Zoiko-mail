import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser, stepUpHeader } from "./helpers.js";

const app = createApp();

/**
 * A new workspace starts empty, and stays that way however busy its neighbours are.
 *
 * Isolation is asserted in pieces across a dozen suites — one endpoint each,
 * usually as the last case in a file about something else. What none of them
 * answers is the question an operator actually asks: *if I sign up right now,
 * do I see anything at all?* A leak on any single endpoint is invisible to a
 * per-endpoint test that happens not to cover it.
 *
 * So this sweeps the whole read surface twice: once against a workspace that
 * has never done anything, and once after a neighbour has filled its own with
 * members, mailboxes, domains, policies, tickets and contacts. Adding a list
 * endpoint without adding it here is the gap this is meant to make obvious.
 *
 * Worth knowing what backs this up. Only eight tables carry row-level
 * security — the high-sensitivity set Security §8.1 names — so for the other
 * forty-two, isolation is whatever the `where: { tenantId }` in the query
 * says it is. That is exactly the kind of guarantee that holds everywhere
 * until one query forgets, and nothing about a forgotten clause looks wrong
 * on the screen it leaks to.
 */

/** Every list an authenticated workspace member can read. */
const READ_SURFACE: Array<{ path: string; collection: string }> = [
  { path: "/api/v1/membership/members", collection: "members" },
  { path: "/api/v1/mail/admin/mailboxes", collection: "mailboxes" },
  { path: "/api/v1/mail/admin/shared-mailboxes", collection: "mailboxes" },
  { path: "/api/v1/domains", collection: "domains" },
  { path: "/api/v1/policies", collection: "policies" },
  { path: "/api/v1/audit/events", collection: "events" },
  { path: "/api/v1/contacts", collection: "contacts" },
  { path: "/api/v1/support/tickets", collection: "tickets" },
  { path: "/api/v1/connectors", collection: "accounts" },
  { path: "/api/v1/security-alerts", collection: "alerts" },
  { path: "/api/v1/notifications", collection: "notifications" },
  { path: "/api/v1/lifecycle", collection: "requests" },
  { path: "/api/v1/mail", collection: "messages" },
  { path: "/api/v1/actions", collection: "actions" },
  { path: "/api/v1/jobs", collection: "jobs" },
];

function rows(body: unknown, collection: string): unknown[] {
  const data = (body as { data?: Record<string, unknown> }).data ?? {};
  const value = data[collection];
  if (Array.isArray(value)) return value;
  if (Array.isArray(data)) return data as unknown[];
  return [];
}

/** A workspace with a member, a mailbox, a domain, a policy, a ticket and a contact. */
async function busyWorkspace(suffix: string) {
  const owner = await registerUser(app, { email: `iso-busy-${suffix}@zoiko.test` });

  const memberEmail = `iso-busy-member-${suffix}@zoiko.test`;
  await registerUser(app, { email: memberEmail });
  const member = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email: memberEmail, role: "MEMBER" })
    .expect(201);

  await request(app)
    .post("/api/v1/mail/admin/mailboxes")
    .set(authHeader(owner.accessToken))
    .send({ membershipId: member.body.data.id })
    .expect(201);

  await request(app)
    .post("/api/v1/domains")
    .set(authHeader(owner.accessToken))
    .send({ domainName: `busy-${suffix}.test` })
    .expect(201);

  await request(app)
    .post("/api/v1/policies")
    .set(authHeader(owner.accessToken))
    .send({
      type: "SENDING",
      name: `Busy ${suffix}`,
      rules: { defaultEffect: "ALLOW", conditions: [] },
    })
    .expect(201);

  await request(app)
    .post("/api/v1/contacts")
    .set(authHeader(owner.accessToken))
    .send({ email: `someone-${suffix}@outside.test`, firstName: "Someone" })
    .expect(201);

  await request(app)
    .post("/api/v1/tickets")
    .set(authHeader(owner.accessToken))
    .send({ subject: `Busy ticket ${suffix}`, body: "Something happened" });

  return owner;
}

describe("a new workspace starts empty", () => {
  /**
   * "Zero rows" turned out to be the wrong property to assert, and the
   * difference matters.
   *
   * A new workspace is not blank. It contains its own owner, and
   * `tenant.service.ts` gives it a default sending policy and a default AI
   * policy at creation — sensible defaults, carrying that workspace's own
   * tenantId. A test demanding emptiness would fail on correct behaviour and
   * then get "fixed" by deleting the defaults.
   *
   * What isolation actually promises is narrower and stronger: every row you
   * can see is yours. That is what this checks, and it would still catch a
   * leak that an emptiness check would miss — a neighbour's row arriving in a
   * list that legitimately has rows of its own.
   */
  it("shows only rows that belong to it", async () => {
    const fresh = await registerUser(app, { email: `iso-fresh-${Date.now()}@zoiko.test` });

    const foreign: string[] = [];
    for (const { path, collection } of READ_SURFACE) {
      const res = await request(app).get(path).set(authHeader(fresh.accessToken));
      // A refusal is fine — the caller may simply not hold that capability.
      // Returning somebody else's rows is not.
      if (res.status !== 200) continue;
      for (const row of rows(res.body, collection)) {
        const owner = (row as { tenantId?: string }).tenantId;
        // Not every DTO carries tenantId; those are covered by the
        // neighbour sweep below, which knows what the other workspace made.
        if (owner && owner !== fresh.tenantId) {
          foreign.push(`${path} -> row owned by ${owner}`);
        }
      }
    }

    expect(foreign, "a workspace must only ever see its own rows").toEqual([]);
  });

  it("sees only itself in the one list that is not empty", async () => {
    const fresh = await registerUser(app, { email: `iso-self-${Date.now()}@zoiko.test` });

    const res = await request(app)
      .get("/api/v1/membership/members")
      .set(authHeader(fresh.accessToken))
      .expect(200);

    expect(res.body.data.members).toHaveLength(1);
    expect(res.body.data.members[0].user.email).toBe(fresh.email);
  });
});

describe("a busy neighbour changes nothing", () => {
  it("still returns nothing to a workspace created alongside it", async () => {
    const suffix = String(Date.now());
    const busy = await busyWorkspace(suffix);
    const fresh = await registerUser(app, { email: `iso-quiet-${suffix}@zoiko.test` });

    const leaked: string[] = [];
    for (const { path, collection } of READ_SURFACE) {
      const res = await request(app).get(path).set(authHeader(fresh.accessToken));
      if (res.status !== 200) continue;
      for (const row of rows(res.body, collection)) {
        const owner = (row as { tenantId?: string }).tenantId;
        if (owner && owner !== fresh.tenantId) {
          leaked.push(`${path} -> row owned by ${owner}`);
        }
      }
      // The neighbour's rows are identifiable by content too, for the DTOs
      // that do not carry a tenantId — a domain named after their suffix
      // appearing here would be a leak no ownership check could see.
      const serialised = JSON.stringify(rows(res.body, collection));
      if (serialised.includes(`busy-${suffix}`)) {
        leaked.push(`${path} -> contains the neighbour's data`);
      }
    }

    expect(leaked, "a new workspace must not see a neighbour's data").toEqual([]);
    // And the busy one does have the data, so the sweep above proves
    // isolation rather than proving the endpoints return nothing to anyone.
    const theirs = await request(app)
      .get("/api/v1/domains")
      .set(authHeader(busy.accessToken))
      .expect(200);
    expect(theirs.body.data.domains.length).toBeGreaterThan(0);
  });

  it("does not leak a neighbour's rows through a guessed id", async () => {
    const suffix = String(Date.now());
    const busy = await busyWorkspace(`idor-${suffix}`);
    const fresh = await registerUser(app, { email: `iso-idor-${suffix}@zoiko.test` });

    const theirDomain = (
      await request(app).get("/api/v1/domains").set(authHeader(busy.accessToken)).expect(200)
    ).body.data.domains[0].id as string;

    // Holding the id is not holding the right to read it. A tenant-scoped
    // lookup answers 404 rather than 403 — whether a given id exists in
    // another workspace is not this caller's to learn.
    const res = await request(app)
      .get(`/api/v1/domains/${theirDomain}/checks`)
      .set(authHeader(fresh.accessToken));
    expect([403, 404]).toContain(res.status);
  });

  it("does not let a neighbour's id be written to either", async () => {
    const suffix = String(Date.now());
    const busy = await busyWorkspace(`write-${suffix}`);
    const fresh = await registerUser(app, { email: `iso-write-${suffix}@zoiko.test` });

    const theirDomain = (
      await request(app).get("/api/v1/domains").set(authHeader(busy.accessToken)).expect(200)
    ).body.data.domains[0].id as string;

    const stepUp = await stepUpHeader(app, fresh.accessToken);
    const res = await request(app)
      .delete(`/api/v1/domains/${theirDomain}`)
      .set(authHeader(fresh.accessToken))
      .set(stepUp)
      .set("Idempotency-Key", `iso-${suffix}`);
    expect([403, 404]).toContain(res.status);

    // And it is still there afterwards.
    const after = await request(app)
      .get("/api/v1/domains")
      .set(authHeader(busy.accessToken))
      .expect(200);
    expect(after.body.data.domains.some((d: { id: string }) => d.id === theirDomain)).toBe(true);
  });
});

describe("what a workspace sees is its own activity", () => {
  it("reflects a change the moment it is made, without a cache in the way", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `iso-live-${suffix}@zoiko.test` });

    const before = await request(app)
      .get("/api/v1/domains")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(before.body.data.domains).toHaveLength(0);

    await request(app)
      .post("/api/v1/domains")
      .set(authHeader(owner.accessToken))
      .send({ domainName: `live-${suffix}.test` })
      .expect(201);

    // No polling interval, no revalidation window: the next read is the truth.
    const after = await request(app)
      .get("/api/v1/domains")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(after.body.data.domains).toHaveLength(1);
    expect(after.body.data.domains[0].domainName).toBe(`live-${suffix}.test`);
  });
});
