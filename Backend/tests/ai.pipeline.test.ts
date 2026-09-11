import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";
import { jobService } from "../src/modules/job/job.service.js";
import { aiProvider } from "../src/modules/ai/ai.provider.js";

const app = createApp();

async function seedActiveAIPolicy(tenantId: string) {
  const existing = await prisma.tenantPolicy.findFirst({ where: { tenantId, type: "AI" } });
  if (existing) return existing;
  return prisma.tenantPolicy.create({
    data: {
      tenantId,
      type: "AI",
      name: "Allow AI processing",
      version: 1,
      status: "ACTIVE",
      rules: { defaultEffect: "ALLOW", conditions: [] },
      createdByUserId: (await prisma.tenantMembership.findFirstOrThrow({ where: { tenantId } })).userId,
    },
  });
}

async function seedInboxMessage(tenantId: string, membershipId: string, body: string) {
  const mailbox = await prisma.mailbox.upsert({
    where: { membershipId },
    update: {},
    create: { tenantId, membershipId, address: "member@zoiko.test" },
  });
  const thread = await prisma.messageThread.create({
    data: {
      tenantId,
      subjectNormalized: "project update",
      participants: ["alice@example.com", "member@zoiko.test"],
      firstMessageAt: new Date(),
      lastMessageAt: new Date(),
    },
  });
  const message = await prisma.emailMessage.create({
    data: {
      tenantId,
      authorUserId: membershipId === "" ? tenantId : (await prisma.tenantMembership.findFirstOrThrow({ where: { tenantId } })).userId,
      threadId: thread.id,
      subject: "Project update",
      textBody: body,
      status: "RECEIVED",
      sentAt: new Date(),
      providerType: "GMAIL",
      providerMessageId: `pm-${Date.now()}`,
      fromAddress: "alice@example.com",
      fromName: "Alice",
      mailboxItems: {
        create: { tenantId, mailboxId: mailbox.id, folder: "INBOX", isRead: false },
      },
      securityFlags: {},
    },
  });
  return { message, mailbox, thread };
}

describe("AI extraction pipeline (ZM-BE-007/008/009)", () => {
  it("processes an AI_EXTRACTION job into reviewable COMPLETED actions", async () => {
    const owner = await registerUser(app, { email: `ai-extract-${Date.now()}@zoiko.test` });
    await seedActiveAIPolicy(owner.tenantId);
    const { message } = await seedInboxMessage(
      owner.tenantId,
      owner.membershipId,
      "Hi, I will send the report by Friday. Could you also review and approve the draft?"
    );

    await jobService.enqueue({
      tenantId: owner.tenantId,
      userId: owner.userId,
      type: "AI_EXTRACTION",
      payload: { messageId: message.id, threadId: message.threadId },
      idempotencyKey: `ai-extract-${message.id}`,
    });
    const result = await jobService.processNext();
    expect(result.processed).toBe(true);
    expect(result.type).toBe("AI_EXTRACTION");

    const actions = await prisma.aIAction.findMany({
      where: { tenantId: owner.tenantId, messageId: message.id, status: "COMPLETED" },
    });
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.actionType === "COMMITMENT_EXTRACTION")).toBe(true);
    expect(actions.some((a) => a.actionType === "DEADLINE")).toBe(true);
    expect(actions.some((a) => a.actionType === "APPROVAL")).toBe(true);

    // Reprocessing the job is idempotent — no duplicate actions.
    const before = await prisma.aIAction.count({ where: { tenantId: owner.tenantId } });
    await jobService.processNext();
    expect(await prisma.aIAction.count({ where: { tenantId: owner.tenantId } })).toBe(before);
  });

  it("rejects AI extraction when the policy denies it", async () => {
    const owner = await registerUser(app, { email: `ai-deny-${Date.now()}@zoiko.test` });
    await prisma.tenantPolicy.updateMany({
      where: { tenantId: owner.tenantId, type: "AI" },
      data: { rules: { defaultEffect: "DENY", conditions: [] } },
    });
    const { message } = await seedInboxMessage(owner.tenantId, owner.membershipId, "I will follow up tomorrow.");

    await jobService.enqueue({
      tenantId: owner.tenantId,
      userId: owner.userId,
      type: "AI_EXTRACTION",
      payload: { messageId: message.id, threadId: message.threadId },
      idempotencyKey: `ai-extract-${message.id}`,
    });
    const result = await jobService.processNext();
    expect((result as { error?: string }).error).toBeUndefined();
    const actions = await prisma.aIAction.count({ where: { tenantId: owner.tenantId } });
    expect(actions).toBe(0);
  });

  it("confirms a commitment action into a Commitment with sourceAiActionId", async () => {
    const owner = await registerUser(app, { email: `ai-commit-${Date.now()}@zoiko.test` });
    await seedActiveAIPolicy(owner.tenantId);
    const { message } = await seedInboxMessage(owner.tenantId, owner.membershipId, "I will send the figures today.");

    await jobService.enqueue({
      tenantId: owner.tenantId,
      userId: owner.userId,
      type: "AI_EXTRACTION",
      payload: { messageId: message.id, threadId: message.threadId },
      idempotencyKey: `ai-extract-${message.id}`,
    });
    await jobService.processNext();

    const commitmentAction = await prisma.aIAction.findFirstOrThrow({
      where: { tenantId: owner.tenantId, messageId: message.id, actionType: "COMMITMENT_EXTRACTION" },
    });

    const res = await request(app)
      .patch(`/api/v1/ai/actions/${commitmentAction.id}/review`)
      .set(authHeader(owner.accessToken))
      .send({ status: "CONFIRMED" })
      .expect(200);
    expect(res.body.data.status).toBe("CONFIRMED");

    const commitment = await prisma.commitment.findFirstOrThrow({
      where: { tenantId: owner.tenantId, sourceAiActionId: commitmentAction.id },
    });
    expect(commitment.ownerUserId).toBe(owner.userId);
    expect(commitment.messageId).toBe(message.id);

    // Confirming again must not create a duplicate commitment.
    await request(app)
      .patch(`/api/v1/ai/actions/${commitmentAction.id}/review`)
      .set(authHeader(owner.accessToken))
      .send({ status: "CONFIRMED" })
      .expect(404);
  });

  it("confirms a reply action and generates a drafting email in the background", async () => {
    const owner = await registerUser(app, { email: `ai-draft-${Date.now()}@zoiko.test` });
    await seedActiveAIPolicy(owner.tenantId);
    const { message } = await seedInboxMessage(
      owner.tenantId,
      owner.membershipId,
      "Can you confirm the final meeting time for the demo?"
    );

    await jobService.enqueue({
      tenantId: owner.tenantId,
      userId: owner.userId,
      type: "AI_EXTRACTION",
      payload: { messageId: message.id, threadId: message.threadId },
      idempotencyKey: `ai-extract-${message.id}`,
    });
    await jobService.processNext();

    const replyAction = await prisma.aIAction.findFirstOrThrow({
      where: { tenantId: owner.tenantId, messageId: message.id, actionType: "REPLY_OWED" },
    });

    await request(app)
      .patch(`/api/v1/ai/actions/${replyAction.id}/review`)
      .set(authHeader(owner.accessToken))
      .send({ status: "CONFIRMED" })
      .expect(200);

    // The review enqueued the draft-generation job; process the queue.
    const draftJob = await prisma.backgroundJob.findUnique({
      where: {
        tenantId_idempotencyKey: { tenantId: owner.tenantId, idempotencyKey: `ai-draft-${replyAction.id}` },
      },
    });
    expect(draftJob?.type).toBe("AI_DRAFT_GENERATION");

    const result = await jobService.processNext();
    expect(result.processed).toBe(true);
    expect(result.type).toBe("AI_DRAFT_GENERATION");

    const drafts = await prisma.emailMessage.findMany({
      where: { tenantId: owner.tenantId, status: "DRAFT" },
      include: { mailboxItems: true, recipients: true },
    });
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts[0].subject.toLowerCase()).toMatch(/^re:/);
    expect(drafts[0].mailboxItems[0].folder).toBe("DRAFTS");
    expect(drafts[0].recipients.some((r) => r.email === "alice@example.com")).toBe(true);
  });

  it("dismisses a completed action without materializing a commitment", async () => {
    const owner = await registerUser(app, { email: `ai-dismiss-${Date.now()}@zoiko.test` });
    await seedActiveAIPolicy(owner.tenantId);
    const { message } = await seedInboxMessage(owner.tenantId, owner.membershipId, "Please approve the draft by Friday.");

    await jobService.enqueue({
      tenantId: owner.tenantId,
      userId: owner.userId,
      type: "AI_EXTRACTION",
      payload: { messageId: message.id, threadId: message.threadId },
      idempotencyKey: `ai-extract-${message.id}`,
    });
    await jobService.processNext();

    const deadlineAction = await prisma.aIAction.findFirstOrThrow({
      where: { tenantId: owner.tenantId, messageId: message.id, actionType: "DEADLINE" },
    });

    const res = await request(app)
      .patch(`/api/v1/ai/actions/${deadlineAction.id}/review`)
      .set(authHeader(owner.accessToken))
      .send({ status: "DISMISSED" })
      .expect(200);
    expect(res.body.data.status).toBe("DISMISSED");

    const commitment = await prisma.commitment.findFirst({
      where: { tenantId: owner.tenantId, sourceAiActionId: deadlineAction.id },
    });
    expect(commitment).toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, targetType: "AIAction", targetId: deadlineAction.id },
    });
    expect(audit?.eventType).toBe("AI_ACTION_DISMISSED");
  });

  it("retries a failed extraction and does not duplicate actions", async () => {
    const owner = await registerUser(app, { email: `ai-retry-${Date.now()}@zoiko.test` });
    await seedActiveAIPolicy(owner.tenantId);
    const { message } = await seedInboxMessage(owner.tenantId, owner.membershipId, "I will send the numbers tomorrow.");

    const spy = vi.spyOn(aiProvider, "extractActions").mockRejectedValueOnce(new Error("provider temporarily unavailable"));

    await jobService.enqueue({
      tenantId: owner.tenantId,
      userId: owner.userId,
      type: "AI_EXTRACTION",
      payload: { messageId: message.id, threadId: message.threadId },
      idempotencyKey: `ai-extract-${message.id}`,
    });

    const first = await jobService.processNext();
    expect(first.processed).toBe(true);
    expect((first as { error?: string }).error).toMatch(/unavailable/);
    const retried = await prisma.backgroundJob.findFirstOrThrow({
      where: { tenantId: owner.tenantId, type: "AI_EXTRACTION" },
    });
    expect(retried.status).toBe("RETRY");
    expect(await prisma.aIAction.count({ where: { tenantId: owner.tenantId, messageId: message.id } })).toBe(0);

    spy.mockRestore();
    const second = await jobService.processNext();
    expect(second.processed).toBe(true);
    expect(second.type).toBe("AI_EXTRACTION");

    const actions = await prisma.aIAction.findMany({
      where: { tenantId: owner.tenantId, messageId: message.id, status: "COMPLETED" },
    });
    expect(actions.length).toBeGreaterThan(0);
    if (actions.length > 1) {
      const hashes = actions.map((a) => a.inputHash);
      expect(new Set(hashes).size).toBe(hashes.length);
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AI draft generation is idempotent (ZM-BE-009)", () => {
  it("does not stack a second draft when an AI_DRAFT_GENERATION job is retried", async () => {
    const owner = await registerUser(app, { email: `ai-draft-retry-${Date.now()}@zoiko.test` });
    await seedActiveAIPolicy(owner.tenantId);
    const { message } = await seedInboxMessage(
      owner.tenantId,
      owner.membershipId,
      "Can you confirm the final meeting time for the demo?"
    );

    await jobService.enqueue({
      tenantId: owner.tenantId,
      userId: owner.userId,
      type: "AI_EXTRACTION",
      payload: { messageId: message.id, threadId: message.threadId },
      idempotencyKey: `ai-extract-${message.id}`,
    });
    await jobService.processNext();

    const replyAction = await prisma.aIAction.findFirstOrThrow({
      where: { tenantId: owner.tenantId, messageId: message.id, actionType: "REPLY_OWED" },
    });
    await request(app)
      .patch(`/api/v1/ai/actions/${replyAction.id}/review`)
      .set(authHeader(owner.accessToken))
      .send({ status: "CONFIRMED" })
      .expect(200);

    await jobService.processNext();
    const draftsAfterFirstRun = await prisma.emailMessage.count({
      where: { tenantId: owner.tenantId, status: "DRAFT" },
    });
    expect(draftsAfterFirstRun).toBe(1);

    // Simulate the at-least-once window: the draft committed but the job's
    // COMPLETED write never landed. Re-run must reuse, not duplicate.
    await prisma.backgroundJob.update({
      where: {
        tenantId_idempotencyKey: { tenantId: owner.tenantId, idempotencyKey: `ai-draft-${replyAction.id}` },
      },
      data: { status: "PENDING", lockedAt: null, runAt: new Date(Date.now() - 60_000) },
    });
    const retried = await jobService.processNext();
    expect(retried.processed).toBe(true);
    expect((retried as { result?: { reused?: boolean } }).result?.reused).toBe(true);

    expect(await prisma.emailMessage.count({ where: { tenantId: owner.tenantId, status: "DRAFT" } })).toBe(1);
  });

  it("collapses two confirmed draft-eligible actions on the same message into one draft", async () => {
    const owner = await registerUser(app, { email: `ai-draft-twin-${Date.now()}@zoiko.test` });
    await seedActiveAIPolicy(owner.tenantId);
    const { message } = await seedInboxMessage(owner.tenantId, owner.membershipId, "Review and approve the draft.");

    // Two distinct extracted actions (e.g. APPROVAL + REPLY_OWED from the same
    // email) both confirmed independently.
    const approval = await prisma.aIAction.create({
      data: {
        tenantId: owner.tenantId,
        createdByUserId: owner.userId,
        actionType: "APPROVAL",
        messageId: message.id,
        threadId: message.threadId,
        inputHash: `twin-approval-${message.id}`,
        output: { text: "Review and approve the requested item", priority: "HIGH" },
        confidenceScore: 0.8,
        sourceExcerpt: "Review and approve the draft",
        status: "CONFIRMED",
      },
    });
    const replyOwed = await prisma.aIAction.create({
      data: {
        tenantId: owner.tenantId,
        createdByUserId: owner.userId,
        actionType: "REPLY_OWED",
        messageId: message.id,
        threadId: message.threadId,
        inputHash: `twin-reply-${message.id}`,
        output: { text: "Send a reply to the sender", priority: "MEDIUM" },
        confidenceScore: 0.7,
        sourceExcerpt: "Can you confirm?",
        status: "CONFIRMED",
      },
    });

    await jobService.enqueue({
      tenantId: owner.tenantId,
      userId: owner.userId,
      type: "AI_DRAFT_GENERATION",
      payload: { aiActionId: approval.id, messageId: message.id, threadId: message.threadId },
      idempotencyKey: `ai-draft-twin-${approval.id}`,
    });
    await jobService.enqueue({
      tenantId: owner.tenantId,
      userId: owner.userId,
      type: "AI_DRAFT_GENERATION",
      payload: { aiActionId: replyOwed.id, messageId: message.id, threadId: message.threadId },
      idempotencyKey: `ai-draft-twin-${replyOwed.id}`,
    });

    await jobService.processNext();
    await jobService.processNext();

    const drafts = await prisma.emailMessage.findMany({
      where: {
        tenantId: owner.tenantId,
        status: "DRAFT",
        mailboxItems: { some: { folder: "DRAFTS" } },
      },
    });
    expect(drafts).toHaveLength(1);
  });
});

describe("AI action feed supports status filtering", () => {
  it("filters the action list by status via query", async () => {
    const owner = await registerUser(app, { email: `ai-feed-${Date.now()}@zoiko.test` });
    await seedActiveAIPolicy(owner.tenantId);
    const { message } = await seedInboxMessage(owner.tenantId, owner.membershipId, "I will review the pull request.");

    await jobService.enqueue({
      tenantId: owner.tenantId,
      userId: owner.userId,
      type: "AI_EXTRACTION",
      payload: { messageId: message.id, threadId: message.threadId },
      idempotencyKey: `ai-extract-${message.id}`,
    });
    await jobService.processNext();

    const res = await request(app)
      .get("/api/v1/ai/actions?status=COMPLETED")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(res.body.data.actions.every((a: { status: string }) => a.status === "COMPLETED")).toBe(true);
    expect(res.body.data.actions.length).toBeGreaterThan(0);
  });
});