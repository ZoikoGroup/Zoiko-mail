import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();
const rules = {
  defaultEffect: "ALLOW",
  conditions: [{ field: "recipient.external", operator: "EQUALS", value: true, effect: "DENY" }],
};

describe("Tenant policy module", () => {
  it("creates versions, activates one version, and evaluates deterministically", async () => {
    // Each workspace is bootstrapped with default SENDING and AI policies at
    // version 1, so the first custom policy starts at version 2.
    const owner = await registerUser(app, { email: "policy-owner@zoiko.test" });
    const first = await request(app).post("/api/v1/policies").set(authHeader(owner.accessToken))
      .send({ type: "SENDING", name: "Sending v1", rules }).expect(201);
    const second = await request(app).post("/api/v1/policies").set(authHeader(owner.accessToken))
      .send({ type: "SENDING", name: "Sending v2", rules: { ...rules, defaultEffect: "DENY" } }).expect(201);
    expect(first.body.data.version).toBe(2);
    expect(second.body.data.version).toBe(3);

    await request(app).post(`/api/v1/policies/${first.body.data.id}/activate`)
      .set(authHeader(owner.accessToken)).expect(200);
    await request(app).post(`/api/v1/policies/${second.body.data.id}/activate`)
      .set(authHeader(owner.accessToken)).expect(200);

    expect((await prisma.tenantPolicy.findUnique({ where: { id: first.body.data.id } }))?.status).toBe("ARCHIVED");
    const denied = await request(app).post("/api/v1/policies/evaluate").set(authHeader(owner.accessToken))
      .send({ type: "SENDING", context: { recipient: { external: true } } }).expect(200);
    expect(denied.body.data).toMatchObject({ effect: "DENY", reason: "CONDITION_MATCHED", version: 3 });
  });

  it("fails closed without an active policy and prevents cross-tenant reads", async () => {
    const first = await registerUser(app, { email: "policy-boundary-one@zoiko.test" });
    const second = await registerUser(app, { email: "policy-boundary-two@zoiko.test" });
    const policy = await request(app).post("/api/v1/policies").set(authHeader(first.accessToken))
      .send({ type: "AI", name: "AI policy", rules }).expect(201);

    await request(app).get(`/api/v1/policies/${policy.body.data.id}`)
      .set(authHeader(second.accessToken)).expect(404);

    // Every workspace is bootstrapped with an active default AI policy.
    // Archive it so this tenant has none active, exercising fail-closed.
    await prisma.tenantPolicy.updateMany({
      where: { tenantId: second.tenantId, type: "AI", status: "ACTIVE" },
      data: { status: "ARCHIVED" },
    });
    const evaluation = await request(app).post("/api/v1/policies/evaluate")
      .set(authHeader(second.accessToken)).send({ type: "AI", context: {} }).expect(200);
    expect(evaluation.body.data).toMatchObject({ effect: "DENY", reason: "NO_ACTIVE_POLICY" });
  });

  it("allows members to evaluate but not administer policies", async () => {
    const owner = await registerUser(app, { email: "policy-admin-owner@zoiko.test" });
    const member = await registerUser(app, { email: "policy-member@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);
    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId }).expect(200);
    const token = login.body.data.session.accessToken;
    await request(app).post("/api/v1/policies/evaluate").set(authHeader(token))
      .send({ type: "ABUSE", context: {} }).expect(200);
    await request(app).get("/api/v1/policies").set(authHeader(token)).expect(403);
  });

  it("previews and explicitly executes active retention policy cleanup", async () => {
    const owner = await registerUser(app, { email: "retention-owner@zoiko.test" });
    const member = await registerUser(app, { email: "retention-member@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);
    const memberLogin = await request(app).post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId }).expect(200);

    const sending = await request(app).post("/api/v1/policies").set(authHeader(owner.accessToken))
      .send({ type: "SENDING", name: "Allow internal", rules: { defaultEffect: "ALLOW", conditions: [] } }).expect(201);
    await request(app).post(`/api/v1/policies/${sending.body.data.id}/activate`)
      .set(authHeader(owner.accessToken)).expect(200);
    const retention = await request(app).post("/api/v1/policies").set(authHeader(owner.accessToken))
      .send({
        type: "RETENTION",
        name: "Delete after 30 days",
        rules: {
          defaultEffect: "DENY",
          conditions: [{
            field: "message.ageDays",
            operator: "GREATER_THAN_OR_EQUAL",
            value: 30,
            effect: "ALLOW",
          }],
        },
      }).expect(201);
    await request(app).post(`/api/v1/policies/${retention.body.data.id}/activate`)
      .set(authHeader(owner.accessToken)).expect(200);

    const createAndSend = async (subject: string) => {
      const draft = await request(app).post("/api/v1/mail/drafts").set(authHeader(owner.accessToken))
        .send({ subject, recipients: { to: [member.email] } }).expect(201);
      await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
        .set(authHeader(owner.accessToken)).expect(200);
      return draft.body.data.id as string;
    };
    const oldMessageId = await createAndSend("Old retained message");
    await createAndSend("Recent retained message");
    await prisma.emailMessage.update({
      where: { id: oldMessageId },
      data: { createdAt: new Date(Date.now() - 45 * 86_400_000) },
    });

    const preview = await request(app).post("/api/v1/policies/retention/preview")
      .set(authHeader(owner.accessToken)).send({}).expect(200);
    expect(preview.body.data).toMatchObject({ eligibleCount: 1, policyId: retention.body.data.id });
    await request(app).post("/api/v1/policies/retention/execute")
      .set(authHeader(owner.accessToken)).send({ confirmation: "wrong" }).expect(400);
    await request(app).post("/api/v1/policies/retention/execute")
      .set(authHeader(memberLogin.body.data.session.accessToken))
      .send({ confirmation: "DELETE_ELIGIBLE_MESSAGES" }).expect(403);
    const executed = await request(app).post("/api/v1/policies/retention/execute")
      .set(authHeader(owner.accessToken))
      .send({ confirmation: "DELETE_ELIGIBLE_MESSAGES" }).expect(200);
    expect(executed.body.data.deletedCount).toBe(1);
    expect(await prisma.emailMessage.findUnique({ where: { id: oldMessageId } })).toBeNull();

    const inbox = await request(app).get("/api/v1/mail?folder=INBOX")
      .set(authHeader(memberLogin.body.data.session.accessToken)).expect(200);
    expect(inbox.body.data.items).toHaveLength(1);
    expect(inbox.body.data.items[0].message.subject).toBe("Recent retained message");
    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "RETENTION_CLEANUP_EXECUTED" },
    });
    expect(audit).not.toBeNull();
  });
});
