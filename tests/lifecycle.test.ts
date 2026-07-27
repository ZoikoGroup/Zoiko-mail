import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { jobService } from "../src/modules/job/job.service.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

describe("Background jobs and data lifecycle", () => {
  it("creates idempotent exports and approval-gated deletion jobs", async () => {
    const owner = await registerUser(app, { email: "lifecycle@zoiko.test" });
    const payload = { idempotencyKey: "export-run-0001", reason: "Customer backup" };
    const first = await request(app).post("/api/v1/lifecycle/exports").set(authHeader(owner.accessToken)).send(payload).expect(202);
    const second = await request(app).post("/api/v1/lifecycle/exports").set(authHeader(owner.accessToken)).send(payload).expect(202);
    expect(second.body.data.job.id).toBe(first.body.data.job.id);
    const processedExport = await jobService.processNext();
    expect(processedExport.processed).toBe(true);
    const download = await request(app)
      .get(`/api/v1/lifecycle/exports/${first.body.data.request.id}/download`)
      .set(authHeader(owner.accessToken))
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
});
