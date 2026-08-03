import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

async function activateSending(accessToken: string) {
  const policy = await request(app)
    .post("/api/v1/policies")
    .set(authHeader(accessToken))
    .send({
      type: "SENDING",
      name: "Allow messages",
      rules: { defaultEffect: "ALLOW", conditions: [] },
    })
    .expect(201);
  await request(app)
    .post(`/api/v1/policies/${policy.body.data.id}/activate`)
    .set(authHeader(accessToken))
    .expect(200);
}

describe("Message and thread module", () => {
  it("lists, searches and reads normalized messages and threads", async () => {
    const owner = await registerUser(app, { email: "message-owner@zoiko.test" });
    const member = await registerUser(app, { email: "message-member@zoiko.test" });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" })
      .expect(201);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId })
      .expect(200);
    const memberToken = login.body.data.accessToken;
    await activateSending(owner.accessToken);

    const draft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({
        subject: "Re: Project Alpha",
        textBody: "The launch decision is ready.",
        recipients: { to: [member.email], bcc: ["hidden@example.com"] },
      })
      .expect(201);

    const ownerDrafts = await request(app)
      .get("/api/v1/messages?folder=DRAFTS&q=launch")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(ownerDrafts.body.data.messages[0].id).toBe(draft.body.data.id);
    expect(ownerDrafts.body.data.messages[0].recipients.some(
      (recipient: { type: string }) => recipient.type === "BCC"
    )).toBe(true);

    await request(app)
      .post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const memberMessages = await request(app)
      .get("/api/v1/messages?folder=INBOX&q=project&unreadOnly=true")
      .set(authHeader(memberToken))
      .expect(200);
    expect(memberMessages.body.data.messages).toHaveLength(1);
    expect(memberMessages.body.data.messages[0].recipients.some(
      (recipient: { type: string }) => recipient.type === "BCC"
    )).toBe(false);

    const detail = await request(app)
      .get(`/api/v1/messages/${draft.body.data.id}`)
      .set(authHeader(memberToken))
      .expect(200);
    expect(detail.body.data.thread.subjectNormalized).toBe("project alpha");

    const threads = await request(app)
      .get("/api/v1/threads?q=project")
      .set(authHeader(memberToken))
      .expect(200);
    expect(threads.body.data.threads).toHaveLength(1);
    const threadId = threads.body.data.threads[0].id;
    const timeline = await request(app)
      .get(`/api/v1/threads/${threadId}`)
      .set(authHeader(memberToken))
      .expect(200);
    expect(timeline.body.data.messages[0].id).toBe(draft.body.data.id);
  });

  it("blocks cross-tenant message and thread access", async () => {
    const first = await registerUser(app, { email: "message-first@zoiko.test" });
    const second = await registerUser(app, { email: "message-second@zoiko.test" });
    const draft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(first.accessToken))
      .send({ subject: "Tenant private", recipients: { to: ["outside@example.com"] } })
      .expect(201);
    const ownerDetail = await request(app)
      .get(`/api/v1/messages/${draft.body.data.id}`)
      .set(authHeader(first.accessToken))
      .expect(200);

    await request(app)
      .get(`/api/v1/messages/${draft.body.data.id}`)
      .set(authHeader(second.accessToken))
      .expect(404);
    await request(app)
      .get(`/api/v1/threads/${ownerDetail.body.data.thread.id}`)
      .set(authHeader(second.accessToken))
      .expect(404);
  });
});
