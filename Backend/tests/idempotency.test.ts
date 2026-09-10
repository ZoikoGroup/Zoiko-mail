import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";
import { purgeExpiredIdempotencyRecords } from "../src/common/middleware/idempotency.js";

const app = createApp();

/**
 * The idempotency contract — API §7.
 *
 * Two endpoints took an `idempotencyKey` in their request body and passed it
 * to the job queue's own deduplication. Every other write was freely
 * replayable, which for a mail product means a retried send sends twice.
 *
 * §7 defines four things and each is pinned here: the header is required, the
 * scope is tenant + actor + endpoint family + key, a repeat of the same
 * payload returns the original response, and a repeat carrying a different
 * payload is refused with 409.
 *
 * These tests set their own keys. The suite-wide patch in setup.ts that gives
 * every other test a fresh key is deliberately not relied on here — it would
 * make the interesting cases untestable.
 */

const KEY = () => `key-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const draftBody = (to: string, subject = "Ticket 9001") => ({
  subject,
  textBody: "Body.",
  recipients: { to: [to], cc: [], bcc: [] },
});

const draft = (token: string, key: string | null, body: Record<string, unknown>) => {
  const call = request(app).post("/api/v1/mail/drafts").set(authHeader(token));
  // A null key means "send none" — and the suite-wide patch in setup.ts has to
  // be told, or it would helpfully add one and hide the case being tested.
  if (key === null) call.set("X-Test-Omit-Idempotency-Key", "1");
  else call.set("Idempotency-Key", key);
  return call.send(body);
};

describe("the header is required on writes", () => {
  it("refuses a write with no key", async () => {
    const owner = await registerUser(app, { email: `idem-none-${Date.now()}@zoiko.test` });

    const refused = await draft(owner.accessToken, null, draftBody(owner.email)).expect(400);

    expect(refused.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    // Nothing was created: the refusal happens before the handler.
    const count = await prisma.emailMessage.count({ where: { tenantId: owner.tenantId } });
    expect(count).toBe(0);
  });

  it("refuses a key too short to be unique", async () => {
    const owner = await registerUser(app, { email: `idem-short-${Date.now()}@zoiko.test` });
    await draft(owner.accessToken, "abc", draftBody(owner.email)).expect(400);
  });

  it("asks nothing of a read", async () => {
    const owner = await registerUser(app, { email: `idem-read-${Date.now()}@zoiko.test` });

    // §7 is about side-effecting operations. A GET that demanded a key would
    // make every list endpoint unusable.
    await request(app)
      .get("/api/v1/mail?folder=INBOX")
      .set(authHeader(owner.accessToken))
      .expect(200);
  });
});

describe("a repeat of the same request", () => {
  it("returns the original response instead of doing the work twice", async () => {
    const owner = await registerUser(app, { email: `idem-replay-${Date.now()}@zoiko.test` });
    const key = KEY();
    const body = draftBody(owner.email);

    const first = await draft(owner.accessToken, key, body).expect(201);
    const second = await draft(owner.accessToken, key, body).expect(201);

    // The same draft, not a second one.
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.headers["idempotent-replay"]).toBe("true");
    const drafts = await prisma.emailMessage.count({ where: { tenantId: owner.tenantId } });
    expect(drafts).toBe(1);
  });

  it("replays the original status code, not a generic 200", async () => {
    const owner = await registerUser(app, { email: `idem-status-${Date.now()}@zoiko.test` });
    const key = KEY();
    const body = draftBody(owner.email);

    await draft(owner.accessToken, key, body).expect(201);
    // A client that branches on 201 has to keep seeing 201.
    await draft(owner.accessToken, key, body).expect(201);
  });

  it("treats a reordered body as the same payload", async () => {
    const owner = await registerUser(app, { email: `idem-order-${Date.now()}@zoiko.test` });
    const key = KEY();

    const first = await draft(owner.accessToken, key, {
      subject: "Ticket 9001",
      textBody: "Body.",
      recipients: { to: [owner.email], cc: [], bcc: [] },
    }).expect(201);

    // Same fields, different order. Clients do not promise key order, so
    // refusing this would refuse an honest retry.
    const second = await draft(owner.accessToken, key, {
      recipients: { cc: [], to: [owner.email], bcc: [] },
      textBody: "Body.",
      subject: "Ticket 9001",
    }).expect(201);

    expect(second.body.data.id).toBe(first.body.data.id);
  });
});

describe("a key reused for something else", () => {
  it("is refused with a payload mismatch", async () => {
    const owner = await registerUser(app, { email: `idem-mismatch-${Date.now()}@zoiko.test` });
    const key = KEY();

    await draft(owner.accessToken, key, draftBody(owner.email, "First")).expect(201);
    const refused = await draft(
      owner.accessToken,
      key,
      draftBody(owner.email, "Second")
    ).expect(409);

    expect(refused.body.error.code).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");
    // The second draft was not created; the caller has to use a fresh key.
    expect(await prisma.emailMessage.count({ where: { tenantId: owner.tenantId } })).toBe(1);
  });

  it("is refused across two routes in the same family", async () => {
    const owner = await registerUser(app, { email: `idem-family-${Date.now()}@zoiko.test` });
    const key = KEY();
    const created = await draft(owner.accessToken, key, draftBody(owner.email)).expect(201);

    // Same family, different operation. The scope is the family, so this is a
    // reused key rather than a new operation — which is the answer that keeps
    // a client from accidentally replaying one intent onto another.
    const refused = await request(app)
      .patch(`/api/v1/mail/drafts/${created.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .set("Idempotency-Key", key)
      .send({ subject: "Changed" })
      .expect(409);
    expect(refused.body.error.code).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");
  });

  it("is free again in a different family", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `idem-other-${suffix}@zoiko.test` });
    // Adding a member requires the account to exist already; the endpoint
    // attaches an existing user to the workspace rather than creating one.
    const invitee = await registerUser(app, { email: `idem-invitee-${suffix}@zoiko.test` });
    const key = KEY();
    await draft(owner.accessToken, key, draftBody(owner.email)).expect(201);

    // A different module is a different family, so the same key names a new
    // operation there. (Labels would not have shown this: they live under
    // /mail and share the family with drafts.)
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .set("Idempotency-Key", key)
      .send({ email: invitee.email, role: "MEMBER" })
      .expect(201);
  });
});

describe("records never deduplicate across tenants or actors", () => {
  it("lets two workspaces use the same key", async () => {
    const suffix = String(Date.now());
    const first = await registerUser(app, { email: `idem-t1-${suffix}@zoiko.test` });
    const second = await registerUser(app, { email: `idem-t2-${suffix}@zoiko.test` });
    const key = KEY();

    await draft(first.accessToken, key, draftBody(first.email)).expect(201);
    // §7: "idempotency records must never deduplicate across tenants." A
    // client-generated key that collided across workspaces would otherwise
    // hand one tenant another tenant's stored response.
    const other = await draft(second.accessToken, key, draftBody(second.email)).expect(201);
    expect(other.headers["idempotent-replay"]).toBeUndefined();
  });

  it("lets two people in one workspace use the same key", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `idem-owner-${suffix}@zoiko.test` });
    const memberEmail = `idem-member-${suffix}@zoiko.test`;
    const member = await registerUser(app, { email: memberEmail });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: memberEmail, role: "MEMBER" })
      .expect(201);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: memberEmail, password: member.password, tenantId: owner.tenantId })
      .expect(200);
    const session = login.body.data.session ?? login.body.data;
    const key = KEY();

    await draft(owner.accessToken, key, draftBody(owner.email)).expect(201);
    // The actor is part of the scope, so colleagues cannot collide either.
    await draft(session.accessToken, key, draftBody(owner.email)).expect(201);
  });
});

describe("a key survives a failure, and expires", () => {
  it("is released when the request fails, so the same key can retry", async () => {
    const owner = await registerUser(app, { email: `idem-fail-${Date.now()}@zoiko.test` });
    const key = KEY();

    // Rejected by validation: no recipients.
    await draft(owner.accessToken, key, {
      subject: "Broken",
      textBody: "No recipients.",
      recipients: { to: [], cc: [], bcc: [] },
    }).expect(400);

    // The same key works now. Burning it on failure would turn a transient
    // error into a permanently poisoned key, and a client that generated one
    // key per intent would have no way forward.
    await draft(owner.accessToken, key, draftBody(owner.email)).expect(201);
  });

  it("frees the key once the 24-hour window has passed", async () => {
    const owner = await registerUser(app, { email: `idem-ttl-${Date.now()}@zoiko.test` });
    const key = KEY();
    const body = draftBody(owner.email);
    await draft(owner.accessToken, key, body).expect(201);

    await prisma.idempotencyRecord.updateMany({
      where: { tenantId: owner.tenantId, key },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // Past the TTL the record is not a replay any more, so the work happens
    // again rather than returning a day-old answer.
    const again = await draft(owner.accessToken, key, body).expect(201);
    expect(again.headers["idempotent-replay"]).toBeUndefined();
    expect(await prisma.emailMessage.count({ where: { tenantId: owner.tenantId } })).toBe(2);
  });

  it("purges expired records and leaves live ones alone", async () => {
    const owner = await registerUser(app, { email: `idem-purge-${Date.now()}@zoiko.test` });
    const live = KEY();
    const stale = KEY();
    await draft(owner.accessToken, live, draftBody(owner.email, "Live")).expect(201);
    await draft(owner.accessToken, stale, draftBody(owner.email, "Stale")).expect(201);
    await prisma.idempotencyRecord.updateMany({
      where: { tenantId: owner.tenantId, key: stale },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const purged = await purgeExpiredIdempotencyRecords();

    expect(purged).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.idempotencyRecord.count({ where: { tenantId: owner.tenantId, key: stale } })
    ).toBe(0);
    expect(
      await prisma.idempotencyRecord.count({ where: { tenantId: owner.tenantId, key: live } })
    ).toBe(1);
  });
});

describe("what a stored record holds", () => {
  it("keeps the status, the body, the actor and an expiry", async () => {
    const owner = await registerUser(app, { email: `idem-store-${Date.now()}@zoiko.test` });
    const key = KEY();
    const created = await draft(owner.accessToken, key, draftBody(owner.email)).expect(201);

    const record = await prisma.idempotencyRecord.findFirstOrThrow({
      where: { tenantId: owner.tenantId, key },
    });

    // §7's storage list: hashed body, status, response body, created_at,
    // expires_at and actor.
    expect(record.actorUserId).toBe(owner.userId);
    expect(record.endpointFamily).toBe("mail");
    expect(record.status).toBe("COMPLETED");
    expect(record.responseStatus).toBe(201);
    expect(record.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect((record.responseBody as { data?: { id?: string } })?.data?.id).toBe(
      created.body.data.id
    );
    // 24 hours from the first accepted request, give or take the test's own
    // runtime.
    const window = record.expiresAt.getTime() - record.createdAt.getTime();
    expect(window).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(window).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5000);
  });
});
