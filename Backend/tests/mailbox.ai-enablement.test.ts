import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";
import { aiService } from "../src/modules/ai/ai.service.js";

const app = createApp();

/**
 * Per-mailbox AI enablement — Data Model §6.16, Security §9, AC-008.
 *
 * "AI cannot process restricted mailboxes unless policy permits" had nothing
 * to read: the AI service passed `mailbox: { eligible: true }` as a literal,
 * so every mailbox was eligible and no tenant policy could say otherwise.
 * A mailbox with ai_enabled = false is what the security spec calls a
 * restricted mailbox.
 */

/** A mailbox for the caller, which is what the AI service looks up. */
async function mailboxFor(owner: { accessToken: string; membershipId: string }) {
  const created = await request(app)
    .post("/api/v1/mail/admin/mailboxes")
    .set(authHeader(owner.accessToken))
    .send({ membershipId: owner.membershipId })
    .expect(201);
  return created.body.data.id as string;
}

/** A thread the caller owns, so the AI request gets past the access check. */
async function threadFor(owner: { accessToken: string }) {
  const draft = await request(app)
    .post("/api/v1/mail/drafts")
    .set(authHeader(owner.accessToken))
    .send({ subject: "Source", textBody: "body", recipients: { to: ["x@example.test"] } })
    .expect(201);
  return draft.body.data.id as string;
}

const requestAi = (token: string, messageId: string) =>
  request(app)
    .post("/api/v1/ai/actions")
    .set(authHeader(token))
    .send({ actionType: "SUMMARY", messageId });

describe("per-mailbox AI enablement", () => {
  it("defaults to enabled, so migrating did not switch AI off for anyone", async () => {
    const owner = await registerUser(app, { email: `ai-default-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(owner);

    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
    expect(mailbox.aiEnabled).toBe(true);
  });

  it("lets AI run on an enabled mailbox", async () => {
    const owner = await registerUser(app, { email: `ai-on-${Date.now()}@zoiko.test` });
    await mailboxFor(owner);
    const messageId = await threadFor(owner);

    await requestAi(owner.accessToken, messageId).expect(202);
  });

  it("refuses AI on a mailbox an admin has restricted", async () => {
    const owner = await registerUser(app, { email: `ai-off-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(owner);
    const messageId = await threadFor(owner);

    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .send({ aiEnabled: false })
      .expect(200);

    const refused = await requestAi(owner.accessToken, messageId).expect(403);
    expect(refused.body.error.details.reason).toBe("MAILBOX_AI_DISABLED");
  });

  it("lets AI run again once the mailbox is re-enabled", async () => {
    const owner = await registerUser(app, { email: `ai-back-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(owner);
    const messageId = await threadFor(owner);

    const toggle = (aiEnabled: boolean) =>
      request(app)
        .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
        .set(authHeader(owner.accessToken))
        .send({ aiEnabled })
        .expect(200);

    await toggle(false);
    await requestAi(owner.accessToken, messageId).expect(403);

    // Restricting a mailbox must not be a one-way door.
    await toggle(true);
    await requestAi(owner.accessToken, messageId).expect(202);
  });

  it("audits the change with both the old and the new value", async () => {
    const owner = await registerUser(app, { email: `ai-audit-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(owner);

    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .send({ aiEnabled: false })
      .expect(200);

    const event = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "MAILBOX_SETTINGS_UPDATED", targetId: mailboxId },
      orderBy: { createdAt: "desc" },
    });

    // §14.1 requires mailbox-level AI enablement to be audited, and a bare
    // "settings updated" cannot answer who turned it off or what it was.
    const metadata = event?.metadata as { before?: Record<string, unknown>; after?: Record<string, unknown> };
    expect(metadata.before?.aiEnabled).toBe(true);
    expect(metadata.after?.aiEnabled).toBe(false);
    expect(event?.actorUserId).toBe(owner.userId);
  });

  it("reports the flag on the admin mailbox list", async () => {
    const owner = await registerUser(app, { email: `ai-list-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(owner);
    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .send({ aiEnabled: false })
      .expect(200);

    const list = await request(app)
      .get("/api/v1/mail/admin/mailboxes")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const rows = list.body.data.mailboxes ?? list.body.data;
    expect(rows.find((m: { id: string }) => m.id === mailboxId).aiEnabled).toBe(false);
  });

  it("refuses a member trying to restrict a mailbox", async () => {
    const owner = await registerUser(app, { email: `ai-owner-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(owner);
    const memberEmail = `ai-member-${Date.now()}@zoiko.test`;
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

    // workspace.mailboxes.manage is Owner/Admin only.
    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(session.accessToken))
      .send({ aiEnabled: false })
      .expect(403);
  });

  it("does not let one workspace restrict another's mailbox", async () => {
    const first = await registerUser(app, { email: `ai-tenant-a-${Date.now()}@zoiko.test` });
    const second = await registerUser(app, { email: `ai-tenant-b-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(first);

    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(second.accessToken))
      .send({ aiEnabled: false })
      .expect(404);

    const untouched = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
    expect(untouched.aiEnabled).toBe(true);
  });
});

describe("the background path is gated too, which is where mail actually arrives", () => {
  /**
   * AC-008 has two entrances and only one of them is a request.
   *
   * A connector enqueues an AI_EXTRACTION job for every message it syncs, so
   * extraction runs on ordinary incoming mail without anybody asking for it.
   * That path checked only the global feature flag, which meant a mailbox with
   * AI switched off was still processed the moment a connector imported into
   * it - the setting held for the API and not for the traffic.
   */
  async function ownerWithRestrictedMailbox(email: string, aiEnabled: boolean) {
    const owner = await registerUser(app, { email });
    const mailboxId = await mailboxFor(owner);
    const messageId = await threadFor(owner);
    if (!aiEnabled) {
      await request(app)
        .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
        .set(authHeader(owner.accessToken))
        .send({ aiEnabled: false })
        .expect(200);
    }
    return { owner, mailboxId, messageId };
  }

  /**
   * A real queued job, because the handler closes the row it was given. A
   * synthetic id would make the skip path look like it worked while hiding
   * whether the job was ever finished.
   */
  async function queuedExtraction(
    owner: { tenantId: string; userId: string },
    messageId: string
  ) {
    const job = await prisma.backgroundJob.create({
      data: {
        tenantId: owner.tenantId,
        createdByUserId: owner.userId,
        type: "AI_EXTRACTION",
        payload: { messageId },
        idempotencyKey: `ai-extract-${messageId}-${Date.now()}`,
        status: "RUNNING",
        lockedAt: new Date(),
      },
      select: { id: true },
    });
    return job.id;
  }

  it("skips extraction for a mailbox an admin has restricted", async () => {
    const { owner, messageId } = await ownerWithRestrictedMailbox(
      `ai-job-off-${Date.now()}@zoiko.test`,
      false
    );
    const jobId = await queuedExtraction(owner, messageId);

    const result = await aiService.processExtraction(
      jobId,
      owner.tenantId,
      owner.userId,
      { messageId }
    );

    expect(result).toMatchObject({ skipped: true, reason: "MAILBOX_AI_DISABLED" });
    // Nothing produced, not even a pending action for somebody to review later.
    expect(await prisma.aIAction.count({ where: { tenantId: owner.tenantId } })).toBe(0);
  });

  it("finishes the job it skipped, rather than leaving it locked forever", async () => {
    const { owner, messageId } = await ownerWithRestrictedMailbox(
      `ai-job-close-${Date.now()}@zoiko.test`,
      false
    );
    const jobId = await queuedExtraction(owner, messageId);

    await aiService.processExtraction(jobId, owner.tenantId, owner.userId, { messageId });

    const job = await prisma.backgroundJob.findFirst({ where: { id: jobId } });
    // RUNNING with a lock is the failure this guards: the claim query only
    // takes PENDING and RETRY, so such a row is never picked up again and
    // never reported as failed either - it just sits there.
    expect(job?.status).toBe("COMPLETED");
    expect(job?.lockedAt).toBeNull();
    expect(job?.completedAt).not.toBeNull();
    expect(job?.result).toMatchObject({ skipped: true, reason: "MAILBOX_AI_DISABLED" });
  });

  it("records the refusal, so a restricted mailbox leaves evidence", async () => {
    const { owner, messageId } = await ownerWithRestrictedMailbox(
      `ai-job-audit-${Date.now()}@zoiko.test`,
      false
    );
    const jobId = await queuedExtraction(owner, messageId);

    await aiService.processExtraction(jobId, owner.tenantId, owner.userId, { messageId });

    const event = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "AI_EXTRACTION_SKIPPED" },
    });
    expect(event).not.toBeNull();
    expect((event?.metadata as { reason?: string })?.reason).toBe("MAILBOX_AI_DISABLED");
  });

  it("does not refuse an enabled mailbox, so the gate is not a blanket block", async () => {
    const { owner, messageId } = await ownerWithRestrictedMailbox(
      `ai-job-on-${Date.now()}@zoiko.test`,
      true
    );
    const jobId = await queuedExtraction(owner, messageId);

    const result = await aiService
      .processExtraction(jobId, owner.tenantId, owner.userId, { messageId })
      .catch((error: unknown) => ({ threw: String(error) }));

    // Whatever the provider then decides, it was not refused for the mailbox.
    expect(JSON.stringify(result)).not.toContain("MAILBOX_AI_DISABLED");
  });
});
