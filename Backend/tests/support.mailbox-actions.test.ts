import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import {
  authHeader,
  loginUser,
  registerUser,
  stepUpHeader,
  type RegisteredUser,
} from "./helpers.js";

const app = createApp();

/**
 * The two RBAC §11.1 support actions that had no endpoint — "Reset mailbox
 * setting (support)" and "Request deletion: Support = Workflow".
 *
 * Both were rows in the matrix naming nothing. The first is the only write a
 * support seat holds, so most of what is asserted here is the shape of that
 * permission rather than the effect: approved by name through its own scope,
 * restoring settings rather than authoring them, and leaving a record the
 * customer can read afterwards.
 */

async function workspace(tag: string) {
  const owner = await registerUser(app, { email: `${tag}-o-${Date.now()}@zoiko.test` });
  const created = await request(app)
    .post("/api/v1/mail/admin/mailboxes")
    .set(authHeader(owner.accessToken))
    .send({ membershipId: owner.membershipId })
    .expect(201);
  return { owner, mailboxId: created.body.data.id as string };
}

/** A support seat holding a grant with exactly the scopes given. */
async function seat(owner: RegisteredUser, tag: string, scopes: readonly string[]) {
  const email = `${tag}-s-${Date.now()}@zoiko.test`;
  const support = await registerUser(app, { email });
  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email, role: "SUPPORT" })
    .expect(201);
  const login = await loginUser(app, support.email, support.password, owner.tenantId);

  const asked = await request(app)
    .post("/api/v1/support/access-requests")
    .set(authHeader(login.accessToken))
    .send({
      reason: "INC-7731 customer reports mail disappearing and cannot send",
      scopes,
      requestedMinutes: 60,
    })
    .expect(201);

  await request(app)
    .post(`/api/v1/support/access-requests/${asked.body.data.id}/approve`)
    .set(authHeader(owner.accessToken))
    .set(await stepUpHeader(app, owner.accessToken))
    .send({})
    .expect(200);

  return { token: login.accessToken as string, userId: support.userId };
}

const reset = (token: string, mailboxId: string, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/v1/support/mailboxes/${mailboxId}/reset-setting`)
    .set(authHeader(token))
    .send(body);

describe("reset mailbox setting", () => {
  it("clears forwarding that is swallowing a customer's mail", async () => {
    const { owner, mailboxId } = await workspace("rf");
    const s = await seat(owner, "rf", ["TENANT_DIAGNOSTICS", "MAILBOX_ADMIN"]);

    await prisma.forwardingRule.create({
      data: {
        tenantId: owner.tenantId,
        mailboxId,
        forwardToAddress: "somewhere-else@elsewhere.test",
        keepCopy: false,
      },
    });

    const res = await reset(s.token, mailboxId, {
      setting: "FORWARDING",
      reason: "INC-7731 customer says inbound mail stopped arriving",
    }).expect(200);

    expect(res.body.data.changed).toBe(1);
    expect(
      await prisma.forwardingRule.count({ where: { tenantId: owner.tenantId, mailboxId } })
    ).toBe(0);
  });

  it("keeps the addresses in the audit entry, because the rule is gone after", async () => {
    const { owner, mailboxId } = await workspace("ra");
    const s = await seat(owner, "ra", ["MAILBOX_ADMIN"]);

    await prisma.forwardingRule.create({
      data: {
        tenantId: owner.tenantId,
        mailboxId,
        forwardToAddress: "exfil@elsewhere.test",
        keepCopy: false,
      },
    });

    await reset(s.token, mailboxId, {
      setting: "FORWARDING",
      reason: "INC-7731 clearing an unexpected forward at the customer's request",
    }).expect(200);

    // A customer asking later where their mail was going has nowhere else
    // to look — the rule was deleted. If the entry does not carry it, the
    // answer is gone.
    const event = await prisma.auditEvent.findFirst({
      where: {
        tenantId: owner.tenantId,
        eventType: "SUPPORT_MAILBOX_SETTING_RESET",
        targetId: mailboxId,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
    expect(JSON.stringify(event?.metadata)).toContain("exfil@elsewhere.test");
  });

  it("lifts a send suspension that has outlived its reason", async () => {
    const { owner, mailboxId } = await workspace("rs");
    const s = await seat(owner, "rs", ["MAILBOX_ADMIN"]);

    await prisma.mailbox.update({
      where: { id: mailboxId },
      data: { sendSuspendedAt: new Date(), sendSuspensionReason: "Bounce rate spike" },
    });

    await reset(s.token, mailboxId, {
      setting: "SEND_SUSPENSION",
      reason: "INC-7731 bounce source fixed, customer asked for sending back",
    }).expect(200);

    const after = await prisma.mailbox.findUniqueOrThrow({
      where: { id: mailboxId },
      select: { sendSuspendedAt: true, sendSuspensionReason: true },
    });
    expect(after.sendSuspendedAt).toBeNull();
    expect(after.sendSuspensionReason).toBeNull();
  });

  it("is refused when the grant does not name MAILBOX_ADMIN", async () => {
    const { owner, mailboxId } = await workspace("rn");
    const s = await seat(owner, "rn", ["TENANT_DIAGNOSTICS"]);

    // The seat holds a live grant and the console works for it. This is not
    // "no access", it is "not this access" — an owner approving a delivery
    // investigation has not approved editing what it found.
    await request(app)
      .get("/api/v1/support/configuration")
      .set(authHeader(s.token))
      .expect(200);

    const res = await reset(s.token, mailboxId, {
      setting: "FORWARDING",
      reason: "INC-7731 trying to clear forwarding without the scope",
    }).expect(403);
    expect(res.body.error.message).toMatch(/MAILBOX_ADMIN/);
  });

  it("refuses an owner — this row is support-only", async () => {
    const { owner, mailboxId } = await workspace("ro");

    // §11.1 marks every other role "—" on this action. An Owner changes
    // their own mailbox settings through mailbox administration, not
    // through a support endpoint that exists to be grant-bound and audited.
    await reset(owner.accessToken, mailboxId, {
      setting: "FORWARDING",
      reason: "INC-7731 owner reaching for the support route",
    }).expect(403);
  });

  it("says so rather than reporting a reset that did nothing", async () => {
    const { owner, mailboxId } = await workspace("rz");
    const s = await seat(owner, "rz", ["MAILBOX_ADMIN"]);

    // Answering 200 here would put a row in the customer's log describing a
    // change that never happened.
    const res = await reset(s.token, mailboxId, {
      setting: "FORWARDING",
      reason: "INC-7731 nothing to clear on this mailbox",
    }).expect(409);
    expect(res.body.error.details?.reason).toBe("NOTHING_TO_RESET");
  });

  it("requires a reason, because §11.1 allows this only if requested", async () => {
    const { owner, mailboxId } = await workspace("rr");
    const s = await seat(owner, "rr", ["MAILBOX_ADMIN"]);

    await reset(s.token, mailboxId, { setting: "FORWARDING", reason: "too short" }).expect(400);
  });

  it("cannot reach a mailbox in another workspace", async () => {
    const { owner } = await workspace("ri");
    const other = await workspace("ri2");
    const s = await seat(owner, "ri", ["MAILBOX_ADMIN"]);

    await reset(s.token, other.mailboxId, {
      setting: "FORWARDING",
      reason: "INC-7731 reaching across a tenant boundary",
    }).expect(404);
  });
});

describe("support raises a deletion request", () => {
  const raise = (token: string, body: Record<string, unknown>) =>
    request(app)
      .post("/api/v1/support/deletion-requests")
      .set(authHeader(token))
      .send(body);

  it("creates one the owner still has to decide", async () => {
    const { owner } = await workspace("dr");
    const s = await seat(owner, "dr", ["TENANT_DIAGNOSTICS"]);

    const res = await raise(s.token, {
      targetType: "TENANT",
      reason: "INC-7731 customer asked for their workspace to be erased",
    }).expect(201);

    // REQUESTED, not approved and not scheduled. §6.14 starts the
    // thirty-day clock at VERIFIED, so support asking does not put the
    // workspace on a deadline — that is the Owner's act.
    expect(res.body.data.status).toBe("REQUESTED");

    const row = await prisma.dataLifecycleRequest.findUniqueOrThrow({
      where: { id: res.body.data.id },
      select: { status: true, type: true, requestedByUserId: true },
    });
    expect(row.type).toBe("DELETION");
    expect(row.status).toBe("REQUESTED");
    expect(row.requestedByUserId).toBe(s.userId);
  });

  it("does not let support carry it any further", async () => {
    const { owner } = await workspace("dw");
    const s = await seat(owner, "dw", ["TENANT_DIAGNOSTICS"]);

    const created = await raise(s.token, {
      targetType: "TENANT",
      reason: "INC-7731 customer asked for erasure",
    }).expect(201);

    // The whole distinction between "Workflow" and a permission. The
    // lifecycle chain is Owner-only and stays that way.
    await request(app)
      .post(`/api/v1/lifecycle/${created.body.data.id}/approve`)
      .set(authHeader(s.token))
      .expect(403);
  });

  it("refuses a second open request for the same target", async () => {
    const { owner } = await workspace("dd");
    const s = await seat(owner, "dd", ["TENANT_DIAGNOSTICS"]);

    await raise(s.token, {
      targetType: "TENANT",
      reason: "INC-7731 customer asked for erasure",
    }).expect(201);

    const again = await raise(s.token, {
      targetType: "TENANT",
      reason: "INC-7731 asked again on a second call",
    }).expect(409);
    expect(again.body.error.details?.reason).toBe("ALREADY_PENDING");
  });

  it("is refused without a grant", async () => {
    const { owner } = await workspace("dn");
    const email = `dn-s-${Date.now()}@zoiko.test`;
    const support = await registerUser(app, { email });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email, role: "SUPPORT" })
      .expect(201);
    const login = await loginUser(app, support.email, support.password, owner.tenantId);

    await raise(login.accessToken, {
      targetType: "TENANT",
      reason: "INC-7731 no grant held at all",
    }).expect(403);
  });

  it("records who raised it and for which case", async () => {
    const { owner } = await workspace("da");
    const s = await seat(owner, "da", ["TENANT_DIAGNOSTICS"]);

    const created = await raise(s.token, {
      targetType: "TENANT",
      reason: "INC-7731 customer asked for erasure on the call",
    }).expect(201);

    const event = await prisma.auditEvent.findFirst({
      where: {
        tenantId: owner.tenantId,
        eventType: "SUPPORT_DELETION_REQUESTED",
        targetId: created.body.data.id,
      },
    });
    expect(event).not.toBeNull();
    expect(event?.actorUserId).toBe(s.userId);
    expect((event?.metadata as Record<string, unknown>)?.grantId).toBeTruthy();
  });
});
