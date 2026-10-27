import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { withCrossTenant } from "../src/config/tenantScope.js";
import { setAssistantModelForTests, type ChatPart, type ChatTurn } from "../src/modules/assistant/assistant.model.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * "Summarize with Alet": an email the member can read is attached as an
 * EMAIL file — headers, full body, attachments and their text — and reaches
 * the model only when the member sends the question. Opened with Mail's own
 * access rules; the mailbox's AI switch and the AI policy apply.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

function fakeModel() {
  const calls: ChatTurn[][] = [];
  setAssistantModelForTests({
    async answer(_system, turns) {
      calls.push(turns);
      return { content: "A summary.", model: "test-model", promptTokens: 1, completionTokens: 1 };
    },
  });
  return calls;
}
afterEach(() => setAssistantModelForTests(null));

const textOf = (turn: ChatTurn) =>
  typeof turn.content === "string" ? turn.content : (turn.content as ChatPart[]).filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");

async function workspace() {
  const owner = await registerUser(app, { email: `ae-owner-${uid()}@zoiko.test`, displayName: "Olive Owner" });
  const join = async (name: string) => {
    const user = await registerUser(app, { email: `ae-${uid()}@zoiko.test`, displayName: name });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken)).send({ email: user.email, role: "MEMBER" }).expect(201);
    const login = await loginUser(app, user.email, user.password, owner.tenantId, user.mfaSecret);
    return { token: login.accessToken as string, email: user.email, tenantId: owner.tenantId };
  };
  return { owner, join };
}

/** Sends a real message from one member to another, optionally with a PDF. */
async function sendMail(from: { token: string }, to: string, body: { subject: string; textBody: string; pdf?: boolean; cc?: string[] }) {
  const draft = await request(app).post("/api/v1/mail/drafts").set(authHeader(from.token))
    .send({ subject: body.subject, textBody: body.textBody, recipients: { to: [to], cc: body.cc ?? [] } }).expect(201);
  if (body.pdf) {
    await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/attachments`).set(authHeader(from.token))
      .attach("file", readFileSync(resolve(__dirname, "fixtures", "Quarterly Plan.pdf")), "Quarterly Plan.pdf").expect(201);
  }
  await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`).set(authHeader(from.token)).expect(200);
  return draft.body.data.id as string;
}

const attach = (token: string, body: object) => request(app).post("/api/v1/assistant/attachments/email").set(authHeader(token)).send(body);

describe("attaching an email", () => {
  it("writes out the headers, the whole body and the attachments' text, and sends nothing to the model", async () => {
    const calls = fakeModel();
    const { join } = await workspace();
    const sender = await join("Sam Sender");
    const reader = await join("Rita Reader");
    const messageId = await sendMail(sender, reader.email, {
      subject: "Q4 plan review",
      textBody: "Hi Rita,\n\nPlease review the attached plan and confirm the budget of £42,000 by Friday 7 November.\n\nThanks, Sam",
      pdf: true,
    });

    const res = (await attach(reader.token, { messageId }).expect(201)).body.data;
    expect(res).toMatchObject({ kind: "EMAIL", fileName: "Q4 plan review", contentType: "message/rfc822" });
    expect(res.email).toMatchObject({ subject: "Q4 plan review", to: [reader.email], attachmentCount: 1 });
    expect(res.email.from).toContain(sender.email);
    expect(res.preview).toContain("Subject: Q4 plan review");
    expect(res.preview).toContain("confirm the budget of £42,000 by Friday 7 November");
    expect(res.preview).toContain("Quarterly Plan.pdf (application/pdf");
    expect(res.preview).toContain("Milestone one: design review on 3 November");
    // Attaching is not asking.
    expect(calls).toHaveLength(0);

    await request(app).post("/api/v1/assistant/messages").set(authHeader(reader.token))
      .send({ content: "Summarize this email.", attachmentIds: [res.id] }).expect(200);
    const turn = calls[0]![calls[0]!.length - 1]!;
    expect(textOf(turn)).toContain("<<<FILE: Q4 plan review (email)>>>");
    expect(textOf(turn)).toContain("£42,000");
    expect(textOf(turn)).toContain("design review on 3 November");
  });

  it("asks for a summary when the email is sent with no words", async () => {
    const calls = fakeModel();
    const { join } = await workspace();
    const sender = await join("Sam Sender");
    const reader = await join("Rita Reader");
    const messageId = await sendMail(sender, reader.email, { subject: "Lunch", textBody: "Lunch at 1pm?" });
    const res = (await attach(reader.token, { messageId }).expect(201)).body.data;
    const reply = (await request(app).post("/api/v1/assistant/messages").set(authHeader(reader.token)).send({ attachmentIds: [res.id] }).expect(200)).body.data;
    expect(reply.messages[0].content).toMatch(/^Summarise this email/);
    expect(reply.conversation.title).toBe("Lunch");
    expect(reply.messages[0].attachments).toEqual([expect.objectContaining({ kind: "EMAIL", fileName: "Lunch" })]);
    expect(calls).toHaveLength(1);
  });

  it("only opens mail the member can read", async () => {
    fakeModel();
    const { join } = await workspace();
    const sender = await join("Sam Sender");
    const reader = await join("Rita Reader");
    const outsider = await join("Otto Outsider");
    const messageId = await sendMail(sender, reader.email, { subject: "Private", textBody: "For Rita only." });
    await attach(outsider.token, { messageId }).expect(404);
    await attach(outsider.token, { messageId: "00000000-0000-4000-8000-000000000999" }).expect(404);
    await attach(reader.token, { messageId: "not-a-uuid" }).expect(400);
  });

  it("respects the mailbox's AI switch, at attach time and again at send time", async () => {
    const calls = fakeModel();
    const { join } = await workspace();
    const sender = await join("Sam Sender");
    const reader = await join("Rita Reader");
    const messageId = await sendMail(sender, reader.email, { subject: "Switch", textBody: "Body" });
    const res = (await attach(reader.token, { messageId }).expect(201)).body.data;

    const switched = await withCrossTenant(() =>
      prisma.mailbox.updateMany({ where: { tenantId: reader.tenantId, address: reader.email }, data: { aiEnabled: false } })
    );
    expect(switched.count).toBe(1);
    expect((await attach(reader.token, { messageId }).expect(403)).body.error.code).toBe("ASSISTANT_MAILBOX_AI_DISABLED");
    await request(app).post("/api/v1/assistant/messages").set(authHeader(reader.token)).send({ attachmentIds: [res.id] }).expect(403);
    expect(calls).toHaveLength(0);
  });

  it("follows the AI policy for mailbox content", async () => {
    fakeModel();
    const { join } = await workspace();
    const sender = await join("Sam Sender");
    const reader = await join("Rita Reader");
    const messageId = await sendMail(sender, reader.email, { subject: "Policy", textBody: "Body" });
    await withCrossTenant(() =>
      prisma.tenantPolicy.updateMany({
        where: { tenantId: reader.tenantId, type: "AI", status: "ACTIVE" },
        data: { rules: { defaultEffect: "ALLOW", conditions: [{ field: "source", operator: "EQUALS", value: "mailbox", effect: "DENY" }] } },
      })
    );
    expect((await attach(reader.token, { messageId }).expect(403)).body.error.code).toBe("ASSISTANT_POLICY_DENIED");
  });

  it("cuts a very long email and says so", async () => {
    fakeModel();
    const { join } = await workspace();
    const sender = await join("Sam Sender");
    const reader = await join("Rita Reader");
    const long = `Start. ${"All the details of the project. ".repeat(2500)}THE-END-MARKER`;
    const messageId = await sendMail(sender, reader.email, { subject: "Long", textBody: long });
    const res = (await attach(reader.token, { messageId }).expect(201)).body.data;
    expect(res.truncated).toBe(true);
    const row = await withCrossTenant(() => prisma.assistantAttachment.findUniqueOrThrow({ where: { id: res.id } }));
    expect(row.extractedText).toContain("The email continues; only the first 60,000 characters are included.");
    expect(row.extractedText).not.toContain("THE-END-MARKER");
  });

  it("does not open the attachments of mail in Spam", async () => {
    fakeModel();
    const { join } = await workspace();
    const sender = await join("Sam Sender");
    const reader = await join("Rita Reader");
    const messageId = await sendMail(sender, reader.email, { subject: "Prize", textBody: "You won", pdf: true });
    await request(app).patch(`/api/v1/mail/${messageId}`).set(authHeader(reader.token)).send({ folder: "SPAM" }).expect(200);
    const res = (await attach(reader.token, { messageId }).expect(201)).body.data;
    expect(res.preview).toContain("in Spam or Quarantine; its attachments were not opened");
    expect(res.preview).not.toContain("Milestone one");
  });
});
