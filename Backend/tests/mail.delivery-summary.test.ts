import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

/**
 * The number behind the admin dashboard's "Failed sends" tile.
 *
 * The tile used to show a count of suspended mailboxes under a label that said
 * failed sends in the last 24 hours — two different things, neither of which
 * was what it claimed. These tests pin the replacement to the three properties
 * that make it trustworthy: it counts delivery *failures* and not adjacent
 * event types, it respects the window, and it never reaches another tenant.
 */

const summary = (token: string, query = "") =>
  request(app)
    .get(`/api/v1/mail/admin/delivery-events/summary${query}`)
    .set(authHeader(token));

/** A message to hang delivery events on. Its content is irrelevant here. */
async function draftMessage(owner: { accessToken: string }, subject: string) {
  const draft = await request(app)
    .post("/api/v1/mail/drafts")
    .set(authHeader(owner.accessToken))
    .send({ subject, textBody: "body", recipients: { to: ["someone@example.test"] } })
    .expect(201);
  return draft.body.data.id as string;
}

async function recordEvents(
  tenantId: string,
  messageId: string,
  events: Array<{ type: string; hoursAgo?: number }>
) {
  for (const event of events) {
    await prisma.deliveryEvent.create({
      data: {
        tenantId,
        messageId,
        type: event.type as never,
        createdAt: new Date(Date.now() - (event.hoursAgo ?? 0) * 3_600_000),
      },
    });
  }
}

describe("admin delivery failure summary", () => {
  it("counts delivery failures and reports them by type", async () => {
    const owner = await registerUser(app, {
      email: `delivery-summary-${Date.now()}@zoiko.test`,
    });
    const messageId = await draftMessage(owner, "Failure mix");

    await recordEvents(owner.tenantId, messageId, [
      { type: "FAILED" },
      { type: "BOUNCED" },
      { type: "BOUNCED" },
      { type: "REJECTED" },
      { type: "BLOCKED" },
      { type: "PROVIDER_ERROR" },
      // None of these are a failed send: the first arrived and was objected
      // to, and the next three are Zoiko declining to send or still trying.
      { type: "COMPLAINED" },
      { type: "SUPPRESSED" },
      { type: "RATE_LIMITED" },
      { type: "DEFERRED" },
      { type: "DELIVERED" },
      { type: "QUEUED" },
      { type: "ACCEPTED" },
    ]);

    const response = await summary(owner.accessToken).expect(200);

    expect(response.body.data.failed).toBe(6);
    expect(response.body.data.byType).toEqual({
      FAILED: 1,
      BOUNCED: 2,
      REJECTED: 1,
      BLOCKED: 1,
      PROVIDER_ERROR: 1,
    });
  });

  it("reports every failure type, including the ones at zero", async () => {
    const owner = await registerUser(app, {
      email: `delivery-zeros-${Date.now()}@zoiko.test`,
    });
    const messageId = await draftMessage(owner, "One bounce");
    await recordEvents(owner.tenantId, messageId, [{ type: "BOUNCED" }]);

    const response = await summary(owner.accessToken).expect(200);

    // An explicit zero rather than a missing key: the tile should never have to
    // tell "no failures of this kind" apart from "this build didn't send it".
    expect(response.body.data.byType).toEqual({
      FAILED: 0,
      BOUNCED: 1,
      REJECTED: 0,
      BLOCKED: 0,
      PROVIDER_ERROR: 0,
    });
  });

  it("ignores failures older than the window", async () => {
    const owner = await registerUser(app, {
      email: `delivery-window-${Date.now()}@zoiko.test`,
    });
    const messageId = await draftMessage(owner, "Old and new");

    await recordEvents(owner.tenantId, messageId, [
      { type: "FAILED", hoursAgo: 1 },
      { type: "FAILED", hoursAgo: 23 },
      // Outside the default 24-hour window.
      { type: "FAILED", hoursAgo: 25 },
      { type: "BOUNCED", hoursAgo: 100 },
    ]);

    const last24 = await summary(owner.accessToken).expect(200);
    expect(last24.body.data.failed).toBe(2);
    expect(last24.body.data.windowHours).toBe(24);

    // Widening the window finds the older ones rather than a different total.
    const lastWeek = await summary(owner.accessToken, "?windowHours=168").expect(200);
    expect(lastWeek.body.data.failed).toBe(4);
    expect(lastWeek.body.data.windowHours).toBe(168);
  });

  it("reports the window it actually used", async () => {
    const owner = await registerUser(app, {
      email: `delivery-since-${Date.now()}@zoiko.test`,
    });

    const response = await summary(owner.accessToken, "?windowHours=6").expect(200);

    const since = new Date(response.body.data.since).getTime();
    const expected = Date.now() - 6 * 3_600_000;
    // The client renders "last 6 hours" from this, so it has to be the real
    // boundary and not a default the server quietly substituted.
    expect(Math.abs(since - expected)).toBeLessThan(60_000);
  });

  it("does not count another workspace's failures", async () => {
    const first = await registerUser(app, {
      email: `delivery-tenant-a-${Date.now()}@zoiko.test`,
    });
    const second = await registerUser(app, {
      email: `delivery-tenant-b-${Date.now()}@zoiko.test`,
    });

    const firstMessage = await draftMessage(first, "Theirs");
    await recordEvents(first.tenantId, firstMessage, [
      { type: "FAILED" },
      { type: "BOUNCED" },
    ]);

    const response = await summary(second.accessToken).expect(200);

    expect(response.body.data.failed).toBe(0);
  });

  it("reads zero for a workspace that has sent nothing", async () => {
    const owner = await registerUser(app, {
      email: `delivery-empty-${Date.now()}@zoiko.test`,
    });

    const response = await summary(owner.accessToken).expect(200);

    expect(response.body.data.failed).toBe(0);
  });

  it("refuses a member", async () => {
    const owner = await registerUser(app, {
      email: `delivery-owner-${Date.now()}@zoiko.test`,
    });
    const memberEmail = `delivery-member-${Date.now()}@zoiko.test`;
    const member = await registerUser(app, { email: memberEmail });

    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: memberEmail, role: "MEMBER" })
      .expect(201);

    const asMember = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: memberEmail, password: member.password, tenantId: owner.tenantId })
      .expect(200);
    const session = asMember.body.data.session ?? asMember.body.data;

    // Tenant-wide delivery health is an operator read, not a member's.
    await summary(session.accessToken).expect(403);
  });

  it("rejects a window outside the allowed range", async () => {
    const owner = await registerUser(app, {
      email: `delivery-badwindow-${Date.now()}@zoiko.test`,
    });

    await summary(owner.accessToken, "?windowHours=0").expect(400);
    await summary(owner.accessToken, "?windowHours=99999").expect(400);
    await summary(owner.accessToken, "?windowHours=notanumber").expect(400);
  });
});
