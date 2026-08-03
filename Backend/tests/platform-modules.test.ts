import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

describe("Provider-independent platform modules", () => {
  it("supports domains, governed AI actions, commitments, notifications and integration links", async () => {
    const owner = await registerUser(app, { email: "platform-owner@zoiko.test" });
    const member = await registerUser(app, { email: "platform-member@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);
    const memberLogin = await request(app).post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId }).expect(200);
    const memberToken = memberLogin.body.data.accessToken;

    const domain = await request(app).post("/api/v1/domains").set(authHeader(owner.accessToken))
      .send({ domainName: "example.test" }).expect(201);
    expect(domain.body.data.verificationToken).toContain("zoiko-mail-verification=");
    expect((await request(app).get("/api/v1/domains").set(authHeader(owner.accessToken)).expect(200)).body.data.domains).toHaveLength(1);

    const draft = await request(app).post("/api/v1/mail/drafts").set(authHeader(owner.accessToken))
      .send({ subject: "Governed work", textBody: "Confirm launch", recipients: { to: [member.email] } }).expect(201);
    const policy = await request(app).post("/api/v1/policies").set(authHeader(owner.accessToken))
      .send({ type: "AI", name: "Allow governed AI", rules: { defaultEffect: "ALLOW", conditions: [] } }).expect(201);
    await request(app).post(`/api/v1/policies/${policy.body.data.id}/activate`).set(authHeader(owner.accessToken)).expect(200);

    const ai = await request(app).post("/api/v1/ai/actions").set(authHeader(owner.accessToken))
      .send({ actionType: "SUMMARY", messageId: draft.body.data.id }).expect(202);
    await request(app).patch(`/api/v1/ai/actions/${ai.body.data.id}/result`).set(authHeader(owner.accessToken))
      .send({ output: { summary: "Launch confirmation" }, confidenceScore: 0.92, sourceExcerpt: "Confirm launch" }).expect(200);
    await request(app).patch(`/api/v1/ai/actions/${ai.body.data.id}/review`).set(authHeader(owner.accessToken))
      .send({ status: "CONFIRMED" }).expect(200);

    const action = await request(app).post("/api/v1/actions").set(authHeader(owner.accessToken))
      .send({ text: "Confirm the launch", ownerUserId: member.userId, messageId: draft.body.data.id, priority: "HIGH" }).expect(201);
    const notifications = await request(app).get("/api/v1/notifications?unreadOnly=true").set(authHeader(memberToken)).expect(200);
    expect(notifications.body.data.notifications).toHaveLength(1);
    await request(app).patch(`/api/v1/notifications/${notifications.body.data.notifications[0].id}/read`)
      .set(authHeader(memberToken)).expect(200);

    const link = await request(app).post("/api/v1/integrations").set(authHeader(owner.accessToken))
      .send({ product: "ZOIKO_ONE", resourceType: "TASK", sourceType: "COMMITMENT", sourceId: action.body.data.id }).expect(201);
    expect(link.body.data).toMatchObject({ status: "PENDING", product: "ZOIKO_ONE" });
  });

  it("keeps new module resources tenant scoped", async () => {
    const first = await registerUser(app, { email: "platform-first@zoiko.test" });
    const second = await registerUser(app, { email: "platform-second@zoiko.test" });
    const domain = await request(app).post("/api/v1/domains").set(authHeader(first.accessToken))
      .send({ domainName: "tenant-private.test" }).expect(201);
    await request(app).post(`/api/v1/domains/${domain.body.data.id}/diagnostics`)
      .set(authHeader(second.accessToken)).expect(404);
  });
});
