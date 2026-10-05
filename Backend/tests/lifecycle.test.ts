import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { jobService } from "../src/modules/job/job.service.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

/**
 * Export now requires a fresh password check (Security §5, AC-003).
 *
 * These calls used to pass on the Owner role alone, because the route gated
 * on the role while the capability matrix marked `data.export` STEP_UP — so
 * the requirement existed on paper and was never asked for. It is asked for
 * now, and these tests have to answer it like any other caller.
 */
async function stepUpToken(user: { accessToken: string; password: string }) {
  const res = await request(app)
    .post("/api/v1/auth/step-up")
    .set(authHeader(user.accessToken))
    .send({ password: user.password })
    .expect(200);
  return res.body.data.stepUpToken as string;
}

/**
 * The worker sweeps every workspace, so "nothing is claimable" is only
 * meaningful once the earlier cases in this file have had their turns. Claims
 * are discarded rather than completed: the assertions below are about which
 * rows the due-date predicate selects, not about what the job does.
 */
async function drainDueWork(claim: () => Promise<unknown>) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await claim())) return;
  }
  throw new Error("claim queue never drained; the timezone assertions below would be vacuous");
}

describe("Background jobs and data lifecycle", () => {
  it("creates idempotent exports and approval-gated deletion jobs", async () => {
    const owner = await registerUser(app, { email: "lifecycle@zoiko.test" });
    const payload = { idempotencyKey: "export-run-0001", reason: "Customer backup" };
    const proof = await stepUpToken(owner);
    const first = await request(app).post("/api/v1/lifecycle/exports").set(authHeader(owner.accessToken)).set("x-step-up-token", proof).send(payload).expect(202);
    const second = await request(app).post("/api/v1/lifecycle/exports").set(authHeader(owner.accessToken)).set("x-step-up-token", proof).send(payload).expect(202);
    expect(second.body.data.job.id).toBe(first.body.data.job.id);
    const processedExport = await jobService.processNext();
    expect(processedExport.processed).toBe(true);
    const download = await request(app)
      .get(`/api/v1/lifecycle/exports/${first.body.data.request.id}/download`)
      .set(authHeader(owner.accessToken))
      .set("x-step-up-token", proof)
      .expect(200);
    expect(download.body.format).toBe("zoiko-mail-tenant-export");
    const serialized = JSON.stringify(download.body);
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("tokenHash");

    const deletion = await request(app).post("/api/v1/lifecycle/deletions").set(authHeader(owner.accessToken))
      .send({ idempotencyKey: "delete-request-01", reason: "Tenant closure requested" }).expect(202);
    expect(deletion.body.data.status).toBe("REQUESTED");
    const approved = await request(app).post(`/api/v1/lifecycle/${deletion.body.data.id}/approve`)
      .set(authHeader(owner.accessToken)).expect(202);
    expect(approved.body.data.request.status).toBe("APPROVED");

    const jobs = await request(app).get("/api/v1/jobs").set(authHeader(owner.accessToken)).expect(200);
    expect(jobs.body.data.jobs).toHaveLength(2);
  });

  it("claims, retries and completes jobs without cross-tenant visibility", async () => {
    const first = await registerUser(app, { email: "jobs-first@zoiko.test" });
    const second = await registerUser(app, { email: "jobs-second@zoiko.test" });
    const queued = await request(app).post("/api/v1/lifecycle/exports").set(authHeader(first.accessToken))
      .set("x-step-up-token", await stepUpToken(first))
      .send({ idempotencyKey: "worker-job-0001" }).expect(202);
    await request(app).get(`/api/v1/jobs/${queued.body.data.job.id}`).set(authHeader(second.accessToken)).expect(404);

    const claimed = await jobService.claim();
    expect(claimed?.status).toBe("RUNNING");
    const retry = await jobService.fail(claimed!.id, first.tenantId, "Temporary failure");
    expect(retry.status).toBe("RETRY");
    await jobService.complete(retry.id, first.tenantId, { exportReady: true });
    const completed = await request(app).get(`/api/v1/jobs/${retry.id}`).set(authHeader(first.accessToken)).expect(200);
    expect(completed.body.data.status).toBe("COMPLETED");
  });

  it("processes idempotent notification digest jobs for the current user", async () => {
    const owner = await registerUser(app, { email: "digest-owner@zoiko.test" });
    const first = await request(app).post("/api/v1/notifications/digests")
      .set(authHeader(owner.accessToken)).send({ idempotencyKey: "daily-digest-001" }).expect(202);
    const second = await request(app).post("/api/v1/notifications/digests")
      .set(authHeader(owner.accessToken)).send({ idempotencyKey: "daily-digest-001" }).expect(202);
    expect(second.body.data.id).toBe(first.body.data.id);

    const processed = await jobService.processNext();
    expect(processed).toEqual(expect.objectContaining({ processed: true, type: "NOTIFICATION_DIGEST" }));
    const notifications = await request(app).get("/api/v1/notifications")
      .set(authHeader(owner.accessToken)).expect(200);
    expect(notifications.body.data.notifications).toEqual([
      expect.objectContaining({ type: "DIGEST", title: "Zoiko Mail digest" }),
    ]);
  });

  it("never deletes without final confirmation and creates a durable deletion receipt", async () => {
    const cancelledOwner = await registerUser(app, {
      email: "delete-cancel@zoiko.test",
      tenantName: "Cancellation Tenant",
    });
    const cancelRequest = await request(app).post("/api/v1/lifecycle/deletions")
      .set(authHeader(cancelledOwner.accessToken))
      .send({ idempotencyKey: "cancel-delete-001", reason: "Testing cancellation" }).expect(202);
    await request(app).post(`/api/v1/lifecycle/${cancelRequest.body.data.id}/approve`)
      .set(authHeader(cancelledOwner.accessToken)).expect(202);
    expect((await jobService.processNext()).processed).toBe(false);
    await request(app).post(`/api/v1/lifecycle/${cancelRequest.body.data.id}/cancel`)
      .set(authHeader(cancelledOwner.accessToken)).expect(200);
    expect(await prisma.tenant.findUnique({ where: { id: cancelledOwner.tenantId } })).not.toBeNull();

    const owner = await registerUser(app, {
      email: "delete-final@zoiko.test",
      tenantName: "Permanent Deletion Tenant",
    });
    const deletion = await request(app).post("/api/v1/lifecycle/deletions")
      .set(authHeader(owner.accessToken))
      .send({ idempotencyKey: "final-delete-001", reason: "Tenant closure" }).expect(202);
    await request(app).post(`/api/v1/lifecycle/${deletion.body.data.id}/approve`)
      .set(authHeader(owner.accessToken)).expect(202);
    expect((await jobService.processNext()).processed).toBe(false);
    await request(app).post(`/api/v1/lifecycle/${deletion.body.data.id}/confirm-deletion`)
      .set(authHeader(owner.accessToken))
      .send({ confirmation: "DELETE_TENANT_PERMANENTLY", tenantName: "Wrong name" }).expect(400);
    await request(app).post(`/api/v1/lifecycle/${deletion.body.data.id}/confirm-deletion`)
      .set(authHeader(owner.accessToken))
      .send({
        confirmation: "DELETE_TENANT_PERMANENTLY",
        tenantName: "Permanent Deletion Tenant",
      }).expect(202);

    const processed = await jobService.processNext();
    expect(processed).toEqual(expect.objectContaining({ processed: true, type: "DATA_DELETION" }));
    expect(await prisma.tenant.findUnique({ where: { id: owner.tenantId } })).toBeNull();
    const receipt = await prisma.tenantDeletionReceipt.findUnique({
      where: { requestId: deletion.body.data.id },
    });
    expect(receipt).not.toBeNull();
    expect(receipt?.tenantNameHash).not.toContain("Permanent Deletion Tenant");
    await request(app).get("/api/v1/auth/me").set(authHeader(owner.accessToken)).expect(403);
  });

  it("leaves a scheduled job alone until its runAt actually arrives", async () => {
    const owner = await registerUser(app, { email: "future-export@zoiko.test" });
    await drainDueWork(() => jobService.claim());
    const scheduled = await prisma.backgroundJob.create({
      data: {
        tenantId: owner.tenantId,
        createdByUserId: owner.userId,
        type: "DATA_EXPORT",
        payload: { scope: "TENANT" },
        idempotencyKey: `future-export-${Date.now()}`,
        runAt: new Date(Date.now() + 3_600_000),
      },
    });

    // run_at is a naive column that Prisma fills with UTC, so comparing it
    // against a session-local CURRENT_TIMESTAMP would read an hour from now as
    // already overdue whenever the database sits east of UTC.
    expect(await jobService.claim()).toBeNull();
    expect(await prisma.backgroundJob.findUniqueOrThrow({ where: { id: scheduled.id } }))
      .toMatchObject({ status: "PENDING", attempts: 0, lockedAt: null });

    // And it is still claimable once the moment genuinely arrives.
    await prisma.backgroundJob.update({
      where: { id: scheduled.id },
      data: { runAt: new Date(Date.now() - 1_000) },
    });
    expect((await jobService.claim())?.id).toBe(scheduled.id);
  });

  it("defers a confirmed deletion job whose runAt is still in the future", async () => {
    const owner = await registerUser(app, { email: "future-deletion@zoiko.test" });
    await drainDueWork(() => jobService.claimSupported());
    const scheduled = await prisma.backgroundJob.create({
      data: {
        tenantId: owner.tenantId,
        createdByUserId: owner.userId,
        type: "DATA_DELETION",
        payload: { requestId: "future-deletion-request", confirmed: true },
        idempotencyKey: `future-deletion-${Date.now()}`,
        runAt: new Date(Date.now() + 3_600_000),
      },
    });

    // The payload clears the confirmed gate, so the only thing holding this job
    // back is the run_at comparison. Claiming it now would erase a tenant an
    // hour before it was scheduled to go.
    expect(await jobService.claimSupported()).toBeNull();
    expect(await prisma.backgroundJob.findUniqueOrThrow({ where: { id: scheduled.id } }))
      .toMatchObject({ status: "PENDING", attempts: 0, lockedAt: null });
  });
});
