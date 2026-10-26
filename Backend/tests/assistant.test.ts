import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { withCrossTenant } from "../src/config/tenantScope.js";
import { AppError } from "../src/common/errors/AppError.js";
import { setAssistantModelForTests, type ChatTurn } from "../src/modules/assistant/assistant.model.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * The AI assistant (Alet). The model is replaced by a stand-in that records
 * what it was asked, so these run without calling OpenAI; the real client is
 * exercised end to end by the browser test against the running API.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

type Call = { system: string; turns: ChatTurn[] };
function fakeModel(reply: (turns: ChatTurn[]) => string = (t) => `Answer to: ${t[t.length - 1]!.content}`) {
  const calls: Call[] = [];
  setAssistantModelForTests({
    async answer(system, turns) {
      calls.push({ system, turns });
      return { content: reply(turns), model: "test-model", promptTokens: 11, completionTokens: 7 };
    },
  });
  return calls;
}

afterEach(() => setAssistantModelForTests(null));

async function member(name = "Mo Member") {
  const owner = await registerUser(app, { email: `as-owner-${uid()}@zoiko.test`, tenantName: "Acme Ltd" });
  const user = await registerUser(app, { email: `as-member-${uid()}@zoiko.test`, displayName: name });
  await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken)).send({ email: user.email, role: "MEMBER" }).expect(201);
  const login = await loginUser(app, user.email, user.password, owner.tenantId, user.mfaSecret);
  return { token: login.accessToken as string, tenantId: owner.tenantId, ownerToken: owner.accessToken };
}

const ask = (token: string, body: object) => request(app).post("/api/v1/assistant/messages").set(authHeader(token)).send(body);

describe("asking the assistant", () => {
  it("answers, saves the question and answer, and remembers the conversation", async () => {
    const calls = fakeModel();
    const { token } = await member("Priya Shah");

    const first = (await ask(token, { content: "  Draft a polite reminder about the invoice  " }).expect(200)).body.data;
    expect(first.conversation.title).toBe("Draft a polite reminder about the invoice");
    expect(first.messages.map((m: { role: string; content: string }) => [m.role, m.content])).toEqual([
      ["USER", "Draft a polite reminder about the invoice"],
      ["ASSISTANT", "Answer to: Draft a polite reminder about the invoice"],
    ]);
    expect(calls[0]!.system).toContain("You are Alet");
    expect(calls[0]!.system).toContain("Priya Shah");
    expect(calls[0]!.system).toContain("Acme Ltd");

    // A follow-up carries the earlier turns, in order.
    await ask(token, { conversationId: first.conversation.id, content: "Make it shorter" }).expect(200);
    expect(calls[1]!.turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(calls[1]!.turns[2]!.content).toBe("Make it shorter");

    const thread = (await request(app).get(`/api/v1/assistant/conversations/${first.conversation.id}`).set(authHeader(token)).expect(200)).body.data;
    expect(thread.messages).toHaveLength(4);
    const list = (await request(app).get("/api/v1/assistant/conversations").set(authHeader(token)).expect(200)).body.data;
    expect(list).toEqual([expect.objectContaining({ id: first.conversation.id, messageCount: 4 })]);
  });

  it("validates the question", async () => {
    fakeModel();
    const { token } = await member();
    expect((await ask(token, { content: "   " }).expect(400)).body.error.code).toBe("VALIDATION_ERROR");
    await ask(token, { content: "x".repeat(4001) }).expect(400);
    await ask(token, { content: "hi", conversationId: "not-a-uuid" }).expect(400);
  });

  it("requires a signed-in member and an Idempotency-Key, and answers a retried question once", async () => {
    const calls = fakeModel();
    const { token } = await member();
    await request(app).post("/api/v1/assistant/messages").send({ content: "hi" }).expect(401);
    await request(app).post("/api/v1/assistant/messages").set(authHeader(token)).set("x-test-omit-idempotency-key", "1").send({ content: "hi" }).expect(400);

    const key = `assistant-retry-${uid()}`;
    const one = await request(app).post("/api/v1/assistant/messages").set(authHeader(token)).set("Idempotency-Key", key).send({ content: "hi" }).expect(200);
    const two = await request(app).post("/api/v1/assistant/messages").set(authHeader(token)).set("Idempotency-Key", key).send({ content: "hi" }).expect(200);
    expect(two.headers["idempotent-replay"]).toBe("true");
    expect(two.body.data.conversation.id).toBe(one.body.data.conversation.id);
    expect(calls).toHaveLength(1);
  });

  it("keeps each person's conversations private", async () => {
    fakeModel();
    const a = await member();
    const b = await member();
    const mine = (await ask(a.token, { content: "My private question" }).expect(200)).body.data.conversation;
    await request(app).get(`/api/v1/assistant/conversations/${mine.id}`).set(authHeader(b.token)).expect(404);
    await ask(b.token, { conversationId: mine.id, content: "let me in" }).expect(404);
    await request(app).delete(`/api/v1/assistant/conversations/${mine.id}`).set(authHeader(b.token)).expect(404);
    expect((await request(app).get("/api/v1/assistant/conversations").set(authHeader(b.token)).expect(200)).body.data).toHaveLength(0);
    // Not even the workspace owner can read it.
    await request(app).get(`/api/v1/assistant/conversations/${mine.id}`).set(authHeader(a.ownerToken)).expect(404);
  });

  it("renames and deletes a conversation", async () => {
    fakeModel();
    const { token } = await member();
    const c = (await ask(token, { content: "Plan my week" }).expect(200)).body.data.conversation;
    expect((await request(app).patch(`/api/v1/assistant/conversations/${c.id}`).set(authHeader(token)).send({ title: "Weekly plan" }).expect(200)).body.data.title).toBe("Weekly plan");
    await request(app).delete(`/api/v1/assistant/conversations/${c.id}`).set(authHeader(token)).expect(204);
    await request(app).get(`/api/v1/assistant/conversations/${c.id}`).set(authHeader(token)).expect(404);
    expect(await withCrossTenant(() => prisma.assistantMessage.count({ where: { conversationId: c.id } }))).toBe(0);
  });
});

describe("when the assistant cannot answer", () => {
  it("reports the model's failure and saves nothing", async () => {
    setAssistantModelForTests({
      async answer() {
        throw new AppError("The AI assistant is busy right now. Wait a moment and try again.", 503, "ASSISTANT_UNAVAILABLE");
      },
    });
    const { token, tenantId } = await member();
    const res = await ask(token, { content: "hello" }).expect(503);
    expect(res.body.error).toMatchObject({ code: "ASSISTANT_UNAVAILABLE", message: expect.stringContaining("busy") });
    expect(await withCrossTenant(() => prisma.assistantConversation.count({ where: { tenantId } }))).toBe(0);
  });

  it("says so plainly when no model is configured", async () => {
    setAssistantModelForTests(null); // the real client; tests run with AI_PROVIDER=mock
    const { token } = await member();
    const res = await ask(token, { content: "hello" }).expect(503);
    expect(res.body.error.code).toBe("ASSISTANT_NOT_CONFIGURED");
    expect(JSON.stringify(res.body)).not.toMatch(/sk-|OPENAI_API_KEY/);
  });

  it("follows the workspace's AI policy", async () => {
    const calls = fakeModel();
    const { token, tenantId } = await member();
    await withCrossTenant(() => prisma.tenantPolicy.updateMany({ where: { tenantId, type: "AI" }, data: { status: "ARCHIVED" } }));
    const res = await ask(token, { content: "hello" }).expect(403);
    expect(res.body.error.code).toBe("ASSISTANT_POLICY_DENIED");
    expect(calls).toHaveLength(0);
  });

  it("is allowed by the AI policy as the seed now writes it, and denied by the old inverted one", async () => {
    const calls = fakeModel();
    const { token, tenantId } = await member();
    const setRules = (conditions: object[]) =>
      withCrossTenant(() =>
        prisma.tenantPolicy.updateMany({ where: { tenantId, type: "AI", status: "ACTIVE" }, data: { rules: { defaultEffect: "ALLOW", conditions } } })
      );

    // Corrected: deny a restricted mailbox and training on customer data. A chat is neither.
    await setRules([
      { field: "source", operator: "EQUALS", value: "restricted_mailbox", effect: "DENY" },
      { field: "training_on_customer_data", operator: "EQUALS", value: true, effect: "DENY" },
    ]);
    await ask(token, { content: "hello" }).expect(200);

    // The inverted rules denied every AI request; the member is told who can fix it.
    await setRules([{ field: "source", operator: "NOT_EQUALS", value: "restricted_mailbox", effect: "DENY" }]);
    const denied = await ask(token, { content: "hello" }).expect(403);
    expect(denied.body.error).toMatchObject({ code: "ASSISTANT_POLICY_DENIED", message: expect.stringContaining("Policies") });
    expect(calls).toHaveLength(1);
  });

  it("gives the model the member's role and the Zoiko Mail product guide", async () => {
    const calls = fakeModel();
    const { token } = await member();
    await ask(token, { content: "How do I delete a contact?" }).expect(200);
    const system = calls[0]!.system;
    expect(system).toContain("a Member of the workspace");
    expect(system).toContain("ZOIKO MAIL — PRODUCT GUIDE");
    expect(system).toContain("trash icon at the end of a contact's row");
    expect(calls[0]!.turns).toEqual([{ role: "user", content: "How do I delete a contact?" }]);
  });

  it("writes usage to the audit log, never the conversation", async () => {
    fakeModel(() => "A confidential answer");
    const { token, tenantId } = await member();
    await ask(token, { content: "A confidential question" }).expect(200);
    const events = await withCrossTenant(() =>
      prisma.auditEvent.findMany({ where: { tenantId, eventType: "ASSISTANT_QUESTION_ANSWERED" } })
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toMatchObject({ model: "test-model", promptTokens: 11, completionTokens: 7 });
    expect(JSON.stringify(events[0])).not.toContain("confidential");
  });
});
