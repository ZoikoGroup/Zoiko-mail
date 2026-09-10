import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";
import { jobService } from "../src/modules/job/job.service.js";
import {
  HARD_DELETE_SLA_DAYS,
  lifecycleService,
} from "../src/modules/lifecycle/lifecycle.service.js";

const app = createApp();

/**
 * The 30-day hard-delete SLA — AC-012, Data Model §6.14.
 *
 * "Customer data subject to deletion must be hard-deleted or irreversibly
 * anonymized within 30 days unless legal/security retention exception
 * applies."
 *
 * The deletion workflow already worked end to end. What it could not do was
 * answer the only question an SLA asks — is this deletion late — because
 * there was no verification moment, no deadline and no way to record a legal
 * hold. These tests pin the clock: who starts it, who may pause it, and what
 * happens when it runs out.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

async function deletionRequest(
  token: string,
  body: Record<string, unknown> = {}
) {
  const created = await request(app)
    .post("/api/v1/lifecycle/deletions")
    .set(authHeader(token))
    .send({ idempotencyKey: `del-${Date.now()}-${Math.random().toString(16).slice(2)}`, reason: "Workspace closure", ...body })
    .expect(202);
  return created.body.data.id as string;
}

const approve = (token: string, id: string) =>
  request(app).post(`/api/v1/lifecycle/${id}/approve`).set(authHeader(token));

const block = (token: string, id: string, reason: string) =>
  request(app).post(`/api/v1/lifecycle/${id}/block`).set(authHeader(token)).send({ reason });

const schedule = (token: string, id: string, scheduledFor: Date) =>
  request(app)
    .post(`/api/v1/lifecycle/${id}/schedule`)
    .set(authHeader(token))
    .send({ scheduledFor: scheduledFor.toISOString() });

const sla = (token: string) =>
  request(app).get("/api/v1/lifecycle/sla").set(authHeader(token));

describe("approval starts the clock", () => {
  it("records the verification moment and a deadline 30 days out", async () => {
    const owner = await registerUser(app, { email: `sla-approve-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);

    const approved = await approve(owner.accessToken, id).expect(202);

    const row = await prisma.dataLifecycleRequest.findUniqueOrThrow({ where: { id } });
    expect(row.verifiedAt).not.toBeNull();
    expect(row.hardDeleteDeadline).not.toBeNull();
    // §6.14: "no later than verified_at + 30 days".
    const window = row.hardDeleteDeadline!.getTime() - row.verifiedAt!.getTime();
    expect(window).toBe(HARD_DELETE_SLA_DAYS * DAY_MS);
    expect(approved.body.data.request.status).toBe("APPROVED");
  });

  it("derives the deadline itself and ignores one supplied by the caller", async () => {
    const owner = await registerUser(app, { email: `sla-derive-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken, {
      // A caller-supplied deadline would make "the scheduler enforces 30 days"
      // a suggestion rather than a rule.
      hardDeleteDeadline: new Date(Date.now() + 900 * DAY_MS).toISOString(),
    });

    await approve(owner.accessToken, id).expect(202);

    const row = await prisma.dataLifecycleRequest.findUniqueOrThrow({ where: { id } });
    const days = Math.round(
      (row.hardDeleteDeadline!.getTime() - row.verifiedAt!.getTime()) / DAY_MS
    );
    expect(days).toBe(HARD_DELETE_SLA_DAYS);
  });

  it("audits the deadline it committed to", async () => {
    const owner = await registerUser(app, { email: `sla-audit-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, id).expect(202);

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { tenantId: owner.tenantId, eventType: "DATA_DELETION_APPROVED", targetId: id },
    });
    const metadata = event.metadata as { hardDeleteDeadline?: string; slaDays?: number };
    expect(metadata.slaDays).toBe(HARD_DELETE_SLA_DAYS);
    expect(metadata.hardDeleteDeadline).toBeTruthy();
  });
});

describe("a legal hold suspends the clock", () => {
  it("blocks with a recorded basis and stops the countdown", async () => {
    const owner = await registerUser(app, { email: `sla-block-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, id).expect(202);

    const blocked = await block(
      owner.accessToken,
      id,
      "Litigation hold requested by counsel, matter 2026-114"
    ).expect(200);

    expect(blocked.body.data.status).toBe("BLOCKED");
    // Cleared rather than left in place: a blocked request is not counting
    // down, and a stale deadline would report a breach for data the workspace
    // is legally required to keep.
    expect(blocked.body.data.hardDeleteDeadline).toBeNull();
    expect(blocked.body.data.blockReason).toContain("Litigation hold");
  });

  it("cancels the pending job, so nothing fires under the hold", async () => {
    const owner = await registerUser(app, { email: `sla-blockjob-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    const approved = await approve(owner.accessToken, id).expect(202);
    const jobId = approved.body.data.job.id as string;

    await block(owner.accessToken, id, "Fraud investigation open with the bank").expect(200);

    const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("CANCELLED");
  });

  it("insists on a stated reason", async () => {
    const owner = await registerUser(app, { email: `sla-noreason-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, id).expect(202);

    // A hold with no stated basis is indistinguishable from a missed deadline.
    await block(owner.accessToken, id, "legal").expect(400);
  });

  it("audits the hold and the lifting of it", async () => {
    const owner = await registerUser(app, { email: `sla-holdaudit-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, id).expect(202);
    await block(owner.accessToken, id, "Preservation order served on 3 September").expect(200);
    await request(app)
      .post(`/api/v1/lifecycle/${id}/unblock`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const types = (
      await prisma.auditEvent.findMany({
        where: { tenantId: owner.tenantId, targetId: id },
        select: { eventType: true },
      })
    ).map((event) => event.eventType);
    expect(types).toContain("DATA_DELETION_BLOCKED");
    expect(types).toContain("DATA_DELETION_UNBLOCKED");
  });

  it("starts a fresh window when the hold is lifted", async () => {
    const owner = await registerUser(app, { email: `sla-unblock-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, id).expect(202);
    await block(owner.accessToken, id, "Contractual retention for the audit period").expect(200);

    const lifted = await request(app)
      .post(`/api/v1/lifecycle/${id}/unblock`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    // Back to the beginning rather than resuming an expired countdown: the
    // data was lawfully retained, and §6.14 measures the window from
    // verification, so the honest thing is to verify again.
    expect(lifted.body.data.status).toBe("REQUESTED");
    expect(lifted.body.data.blockReason).toBeNull();
    expect(lifted.body.data.verifiedAt).toBeNull();

    await approve(owner.accessToken, id).expect(202);
    const row = await prisma.dataLifecycleRequest.findUniqueOrThrow({ where: { id } });
    expect(row.hardDeleteDeadline!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("scheduling stays inside the window", () => {
  it("defers execution and moves the job with it", async () => {
    const owner = await registerUser(app, { email: `sla-sched-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    const approved = await approve(owner.accessToken, id).expect(202);
    const jobId = approved.body.data.job.id as string;
    const when = new Date(Date.now() + 10 * DAY_MS);

    const scheduled = await schedule(owner.accessToken, id, when).expect(200);

    expect(scheduled.body.data.status).toBe("SCHEDULED");
    // The worker only claims jobs whose runAt has arrived, so this is what
    // actually defers the deletion.
    const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.runAt.getTime()).toBe(when.getTime());
  });

  it("refuses a time past the deadline", async () => {
    const owner = await registerUser(app, { email: `sla-late-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, id).expect(202);

    // §6.14: "scheduled_for must be <= hard_delete_deadline".
    const refused = await schedule(
      owner.accessToken,
      id,
      new Date(Date.now() + (HARD_DELETE_SLA_DAYS + 5) * DAY_MS)
    ).expect(422);
    expect(refused.body.error.details.hardDeleteDeadline).toBeTruthy();
  });

  it("refuses a time in the past", async () => {
    const owner = await registerUser(app, { email: `sla-past-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, id).expect(202);
    await schedule(owner.accessToken, id, new Date(Date.now() - DAY_MS)).expect(422);
  });

  it("is refused by the database too, if the service is ever bypassed", async () => {
    const owner = await registerUser(app, { email: `sla-check-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, id).expect(202);

    // The CHECK constraint is the backstop for a scheduling bug that would
    // otherwise breach the SLA silently.
    await expect(
      prisma.dataLifecycleRequest.update({
        where: { id },
        data: { scheduledFor: new Date(Date.now() + 400 * DAY_MS) },
      })
    ).rejects.toThrow();
  });
});

describe("SLA monitoring", () => {
  it("separates what is late from what is merely close", async () => {
    const owner = await registerUser(app, { email: `sla-report-${Date.now()}@zoiko.test` });
    const late = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, late).expect(202);
    await prisma.dataLifecycleRequest.update({
      where: { id: late },
      data: { scheduledFor: null, hardDeleteDeadline: new Date(Date.now() - DAY_MS) },
    });

    const report = await sla(owner.accessToken).expect(200);

    expect(report.body.data.slaDays).toBe(HARD_DELETE_SLA_DAYS);
    expect(report.body.data.overdue).toHaveLength(1);
    expect(report.body.data.overdue[0].id).toBe(late);
    // An overdue deletion is an incident and a blocked one is a decision;
    // reporting them in one list would hide the difference.
    expect(report.body.data.dueSoon).toHaveLength(0);
    expect(report.body.data.blocked).toHaveLength(0);
  });

  it("lists a request due inside the next week", async () => {
    const owner = await registerUser(app, { email: `sla-soon-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, id).expect(202);
    await prisma.dataLifecycleRequest.update({
      where: { id },
      data: { scheduledFor: null, hardDeleteDeadline: new Date(Date.now() + 2 * DAY_MS) },
    });

    const report = await sla(owner.accessToken).expect(200);
    expect(report.body.data.dueSoon.map((r: { id: string }) => r.id)).toContain(id);
  });

  it("shows a held request as held, not as breached", async () => {
    const owner = await registerUser(app, { email: `sla-held-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, id).expect(202);
    await block(owner.accessToken, id, "Regulatory preservation until the enquiry closes").expect(200);

    const report = await sla(owner.accessToken).expect(200);
    expect(report.body.data.blocked.map((r: { id: string }) => r.id)).toContain(id);
    expect(report.body.data.overdue).toHaveLength(0);
  });

  it("keeps one workspace out of another workspace's report", async () => {
    const suffix = String(Date.now());
    const mine = await registerUser(app, { email: `sla-mine-${suffix}@zoiko.test` });
    const theirs = await registerUser(app, { email: `sla-theirs-${suffix}@zoiko.test` });
    const id = await deletionRequest(theirs.accessToken);
    await approve(theirs.accessToken, id).expect(202);

    const report = await sla(mine.accessToken).expect(200);
    expect(report.body.data.dueSoon).toHaveLength(0);
    expect(report.body.data.overdue).toHaveLength(0);
  });
});

describe("the overdue sweep", () => {
  it("records a breach once, not on every pass", async () => {
    const owner = await registerUser(app, { email: `sla-sweep-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, id).expect(202);
    await prisma.dataLifecycleRequest.update({
      where: { id },
      data: { scheduledFor: null, hardDeleteDeadline: new Date(Date.now() - DAY_MS) },
    });

    const first = await lifecycleService.sweepOverdue();
    const second = await lifecycleService.sweepOverdue();

    expect(first.breached).toBe(1);
    // A sweep every fifteen minutes must not turn one late deletion into a
    // flood of identical events.
    expect(second.breached).toBe(0);
    const events = await prisma.auditEvent.count({
      where: { tenantId: owner.tenantId, eventType: "DATA_DELETION_SLA_BREACHED", targetId: id },
    });
    expect(events).toBe(1);
  });

  it("leaves a completed or held request alone", async () => {
    const owner = await registerUser(app, { email: `sla-sweepheld-${Date.now()}@zoiko.test` });
    const id = await deletionRequest(owner.accessToken);
    await approve(owner.accessToken, id).expect(202);
    await block(owner.accessToken, id, "Payment dispute pending with the processor").expect(200);
    await prisma.dataLifecycleRequest.update({
      where: { id },
      data: { hardDeleteDeadline: new Date(Date.now() - 30 * DAY_MS) },
    });

    // Blocked is not open, so it cannot be overdue: the retention is the
    // decision, and flagging it would cry wolf on every sweep.
    expect((await lifecycleService.sweepOverdue()).breached).toBe(0);
  });
});

describe("a user-targeted request anonymizes rather than deletes", () => {
  /**
   * An owner and a member whose only workspace is the owner's.
   *
   * Registration also creates a workspace of the user's own, which would leave
   * them holding a second active membership — the account would then correctly
   * survive the erasure and the anonymization path would never be reached. So
   * that first membership is dropped here, directly, to model the ordinary
   * case of somebody who only ever belonged to one workspace.
   */
  async function ownerWithMember(suffix: string) {
    const owner = await registerUser(app, { email: `anon-owner-${suffix}@zoiko.test` });
    const memberEmail = `anon-member-${suffix}@zoiko.test`;
    const member = await registerUser(app, { email: memberEmail });
    const added = await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: memberEmail, role: "MEMBER" })
      .expect(201);
    await prisma.tenantMembership.deleteMany({
      where: { userId: member.userId, tenantId: member.tenantId },
    });
    return { owner, member, membershipId: added.body.data.id as string };
  }

  it("removes the membership and unlinks the account", async () => {
    const { owner, member } = await ownerWithMember(String(Date.now()));
    const id = await deletionRequest(owner.accessToken, {
      targetType: "USER",
      targetId: member.userId,
      reason: "Leaver, erasure requested",
    });

    await approve(owner.accessToken, id).expect(202);
    const processed = await jobService.processNext();
    expect(processed).toEqual(expect.objectContaining({ processed: true, type: "DATA_DELETION" }));

    expect(
      await prisma.tenantMembership.findFirst({
        where: { tenantId: owner.tenantId, userId: member.userId },
      })
    ).toBeNull();

    const account = await prisma.appUser.findUniqueOrThrow({ where: { id: member.userId } });
    // Irreversibly anonymized, which AC-012 offers as an equal alternative to
    // deletion — and which keeps audit_events pointing at a row that exists,
    // rather than forcing an update the append-only trigger refuses.
    expect(account.email).not.toBe(member.email);
    expect(account.email).toMatch(/@deleted\.invalid$/);
    expect(account.displayName).toBe("Deleted user");
    expect(account.passwordHash).toBeNull();
    expect(account.status).toBe("DISABLED");
  });

  it("marks the request completed, so the SLA is satisfied", async () => {
    const { owner, member } = await ownerWithMember(String(Date.now()));
    const id = await deletionRequest(owner.accessToken, {
      targetType: "USER",
      targetId: member.userId,
    });
    await approve(owner.accessToken, id).expect(202);
    await jobService.processNext();

    const row = await prisma.dataLifecycleRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("COMPLETED");
    expect(row.completedAt).not.toBeNull();
  });

  it("audits which of the two outcomes happened", async () => {
    const { owner, member } = await ownerWithMember(String(Date.now()));
    const id = await deletionRequest(owner.accessToken, {
      targetType: "USER",
      targetId: member.userId,
    });
    await approve(owner.accessToken, id).expect(202);
    await jobService.processNext();

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { tenantId: owner.tenantId, eventType: "DATA_USER_ANONYMIZED" },
    });
    const metadata = event.metadata as {
      accountAnonymized?: boolean;
      remainingActiveMemberships?: number;
    };
    expect(metadata.accountAnonymized).toBe(true);
    expect(metadata.remainingActiveMemberships).toBe(0);
  });

  it("leaves the account alone when another workspace still has them", async () => {
    const suffix = String(Date.now());
    const { owner, member } = await ownerWithMember(suffix);
    // The same person, also a member elsewhere. One workspace's erasure
    // request must not delete another workspace's colleague.
    const other = await registerUser(app, { email: `anon-other-${suffix}@zoiko.test` });
    // Deliberately a second *foreign* workspace rather than one of the
    // member's own, so the assertion is about somebody else's colleague.
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(other.accessToken))
      .send({ email: member.email, role: "MEMBER" })
      .expect(201);

    const id = await deletionRequest(owner.accessToken, {
      targetType: "USER",
      targetId: member.userId,
    });
    await approve(owner.accessToken, id).expect(202);
    await jobService.processNext();

    const account = await prisma.appUser.findUniqueOrThrow({ where: { id: member.userId } });
    expect(account.email).toBe(member.email);
    expect(
      await prisma.tenantMembership.findFirst({
        where: { tenantId: owner.tenantId, userId: member.userId },
      })
    ).toBeNull();
    expect(
      await prisma.tenantMembership.findFirst({
        where: { tenantId: other.tenantId, userId: member.userId },
      })
    ).not.toBeNull();
  });

  it("keeps the audit trail readable after anonymization", async () => {
    const { owner, member } = await ownerWithMember(String(Date.now()));
    const id = await deletionRequest(owner.accessToken, {
      targetType: "USER",
      targetId: member.userId,
    });
    await approve(owner.accessToken, id).expect(202);
    await jobService.processNext();

    // The Audit specification allows retaining audit records after customer
    // data deletion "with minimization/anonymization where required". Because
    // the row survives, every actor reference still resolves.
    const events = await prisma.auditEvent.findMany({
      where: { tenantId: owner.tenantId },
      include: { actor: { select: { id: true, displayName: true } } },
      take: 20,
    });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      if (event.actorUserId) expect(event.actor).not.toBeNull();
    }
  });
});

describe("what a deletion request will not accept", () => {
  it("refuses a target type nothing can execute", async () => {
    const owner = await registerUser(app, { email: `anon-target-${Date.now()}@zoiko.test` });

    // Accepting it would queue an obligation with an SLA that nothing can
    // ever meet.
    const refused = await request(app)
      .post("/api/v1/lifecycle/deletions")
      .set(authHeader(owner.accessToken))
      .send({ idempotencyKey: `del-mailbox-${Date.now()}`, targetType: "MAILBOX", targetId: owner.membershipId })
      .expect(422);
    expect(refused.body.error.details.targetType).toBe("MAILBOX");
  });

  it("refuses a user target with no id", async () => {
    const owner = await registerUser(app, { email: `anon-noid-${Date.now()}@zoiko.test` });
    await request(app)
      .post("/api/v1/lifecycle/deletions")
      .set(authHeader(owner.accessToken))
      .send({ idempotencyKey: `del-noid-${Date.now()}`, targetType: "USER" })
      .expect(422);
  });

  it("refuses an Owner erasing themselves mid-request", async () => {
    const owner = await registerUser(app, { email: `anon-self-${Date.now()}@zoiko.test` });

    // It would remove the only account that can administer the workspace,
    // while that account is the one asking.
    await request(app)
      .post("/api/v1/lifecycle/deletions")
      .set(authHeader(owner.accessToken))
      .send({ idempotencyKey: `del-self-${Date.now()}`, targetType: "USER", targetId: owner.userId })
      .expect(422);
  });
});
