import type { JobType, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { exportStorage } from "../lifecycle/export.storage.js";
import { attachmentStorage } from "../mail/attachment.storage.js";
import { createHash } from "node:crypto";
export class JobService {
  enqueue(input: { tenantId: string; userId: string; type: JobType; payload: Prisma.InputJsonValue; idempotencyKey: string }, tx: Prisma.TransactionClient = prisma) {
    return tx.backgroundJob.upsert({
      where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
      create: { tenantId: input.tenantId, createdByUserId: input.userId, type: input.type, payload: input.payload, idempotencyKey: input.idempotencyKey },
      update: {},
    });
  }
  list(tenantId: string) { return prisma.backgroundJob.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 100 }); }
  async get(id: string, tenantId: string) {
    const job = await prisma.backgroundJob.findFirst({ where: { id, tenantId } });
    if (!job) throw new AppError("Job not found", 404, ErrorCodes.NOT_FOUND);
    return job;
  }
  async claim() {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "background_jobs" SET "status"='RUNNING',"locked_at"=CURRENT_TIMESTAMP,
      "attempts"="attempts"+1,"updated_at"=CURRENT_TIMESTAMP
      WHERE "id"=(SELECT "id" FROM "background_jobs" WHERE "status" IN ('PENDING','RETRY')
      AND "run_at"<=CURRENT_TIMESTAMP ORDER BY "run_at" FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING "id"`;
    return rows[0] ? prisma.backgroundJob.findUnique({ where: { id: rows[0].id } }) : null;
  }
  async claimSupported() {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "background_jobs" SET "status"='RUNNING',"locked_at"=CURRENT_TIMESTAMP,
      "attempts"="attempts"+1,"updated_at"=CURRENT_TIMESTAMP
      WHERE "id"=(SELECT "id" FROM "background_jobs" WHERE "status" IN ('PENDING','RETRY')
      AND (
        "type" IN ('DATA_EXPORT','NOTIFICATION_DIGEST')
        OR ("type"='DATA_DELETION' AND "payload"->>'confirmed'='true')
      )
      AND "run_at"<=CURRENT_TIMESTAMP ORDER BY "run_at" FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING "id"`;
    return rows[0] ? prisma.backgroundJob.findUnique({ where: { id: rows[0].id } }) : null;
  }
  complete(id: string, tenantId: string, result: Prisma.InputJsonValue) {
    return prisma.backgroundJob.update({ where: { id, tenantId }, data: { status: "COMPLETED", result, completedAt: new Date(), lockedAt: null } });
  }
  async fail(id: string, tenantId: string, error: string) {
    const job = await this.get(id, tenantId);
    const retry = job.attempts < job.maxAttempts;
    return prisma.backgroundJob.update({ where: { id, tenantId }, data: { status: retry ? "RETRY" : "FAILED", lastError: error.slice(0, 1000), lockedAt: null, runAt: retry ? new Date(Date.now() + 30_000 * 2 ** Math.max(0, job.attempts - 1)) : job.runAt } });
  }

  async processNext() {
    const job = await this.claimSupported();
    if (!job) return { processed: false };
    try {
      if (job.type === "DATA_EXPORT") {
        const result = await this.processExport(job.id, job.tenantId, job.createdByUserId);
        return { processed: true, jobId: job.id, type: job.type, result };
      }
      if (job.type === "DATA_DELETION") {
        const result = await this.processDeletion(job.id, job.tenantId, job.createdByUserId, job.payload);
        return { processed: true, jobId: job.id, type: job.type, result };
      }
      const result = await this.processDigest(job.id, job.tenantId, job.createdByUserId, job.payload);
      return { processed: true, jobId: job.id, type: job.type, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Background job failed";
      await this.fail(job.id, job.tenantId, message);
      return { processed: true, jobId: job.id, type: job.type, error: message };
    }
  }

  private async processExport(jobId: string, tenantId: string, actorUserId: string) {
    const [tenant, memberships, policies, domains, messages, auditEvents] = await prisma.$transaction([
      prisma.tenant.findFirst({
        where: { id: tenantId },
        select: {
          id: true, name: true, status: true, planCode: true, timezone: true, language: true,
          logoUrl: true, allowedDomains: true, settings: true, createdAt: true, updatedAt: true,
        },
      }),
      prisma.tenantMembership.findMany({
        where: { tenantId },
        select: {
          id: true, role: true, status: true, createdAt: true, updatedAt: true,
          user: { select: { id: true, email: true, displayName: true, status: true, timezone: true, language: true } },
        },
      }),
      prisma.tenantPolicy.findMany({ where: { tenantId }, orderBy: [{ type: "asc" }, { version: "asc" }] }),
      prisma.mailDomain.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
      prisma.emailMessage.findMany({
        where: { tenantId },
        include: {
          recipients: true,
          attachments: { select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.auditEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
    ]);
    if (!tenant) throw new Error("Tenant no longer exists");
    const data = Buffer.from(JSON.stringify({
      format: "zoiko-mail-tenant-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      tenant,
      memberships,
      policies,
      domains,
      messages,
      auditEvents,
    }, null, 2));
    const stored = await exportStorage.save(data);
    const result = {
      ...stored,
      fileName: `zoiko-mail-export-${tenantId}.json`,
      contentType: "application/json",
    };
    try {
      await prisma.$transaction(async (tx) => {
        await tx.backgroundJob.update({
          where: { id: jobId, tenantId },
          data: { status: "COMPLETED", result, completedAt: new Date(), lockedAt: null },
        });
        await tx.dataLifecycleRequest.updateMany({
          where: { tenantId, jobId, type: "EXPORT" },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        await auditService.record({
          tenantId,
          actorUserId,
          eventType: "DATA_EXPORT_COMPLETED",
          targetType: "BackgroundJob",
          targetId: jobId,
          metadata: { sizeBytes: stored.sizeBytes, sha256: stored.sha256 },
        }, tx);
      });
    } catch (error) {
      await exportStorage.delete(stored.storageKey);
      throw error;
    }
    return result;
  }

  private async processDigest(
    jobId: string,
    tenantId: string,
    actorUserId: string,
    payload: Prisma.JsonValue
  ) {
    const requestedUserId = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      && typeof payload.userId === "string" ? payload.userId : actorUserId;
    const membership = await prisma.tenantMembership.findFirst({
      where: { tenantId, userId: requestedUserId, status: "ACTIVE", user: { status: "ACTIVE" } },
      select: { userId: true },
    });
    if (!membership) throw new Error("Digest recipient is inactive");
    const [unreadNotifications, unreadMail] = await prisma.$transaction([
      prisma.notification.count({ where: { tenantId, userId: requestedUserId, readAt: null } }),
      prisma.mailboxMessage.count({
        where: {
          tenantId,
          mailbox: { tenantId, membership: { tenantId, userId: requestedUserId } },
          folder: "INBOX",
          isRead: false,
        },
      }),
    ]);
    const result = { userId: requestedUserId, unreadNotifications, unreadMail };
    await prisma.$transaction(async (tx) => {
      await tx.notification.create({
        data: {
          tenantId,
          userId: requestedUserId,
          type: "DIGEST",
          title: "Zoiko Mail digest",
          body: `You have ${unreadMail} unread mail message(s) and ${unreadNotifications} unread notification(s).`,
          linkPath: "/mail/inbox",
        },
      });
      await tx.backgroundJob.update({
        where: { id: jobId, tenantId },
        data: { status: "COMPLETED", result, completedAt: new Date(), lockedAt: null },
      });
      await auditService.record({
        tenantId,
        actorUserId,
        eventType: "NOTIFICATION_DIGEST_COMPLETED",
        targetType: "BackgroundJob",
        targetId: jobId,
        metadata: result,
      }, tx);
    });
    return result;
  }

  private async processDeletion(
    jobId: string,
    tenantId: string,
    actorUserId: string,
    payload: Prisma.JsonValue
  ) {
    const requestId = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      && payload.confirmed === true && typeof payload.requestId === "string" ? payload.requestId : null;
    if (!requestId) throw new Error("Tenant deletion lacks final confirmation");
    const [tenant, request, attachmentRows, jobs, counts] = await Promise.all([
      prisma.tenant.findFirst({ where: { id: tenantId }, select: { id: true, name: true } }),
      prisma.dataLifecycleRequest.findFirst({
        where: { id: requestId, tenantId, type: "DELETION", status: "PROCESSING", jobId },
        select: { id: true },
      }),
      prisma.messageAttachment.findMany({ where: { tenantId }, select: { storageKey: true } }),
      prisma.backgroundJob.findMany({ where: { tenantId, type: "DATA_EXPORT" }, select: { result: true } }),
      Promise.all([
        prisma.tenantMembership.count({ where: { tenantId } }),
        prisma.emailMessage.count({ where: { tenantId } }),
        prisma.auditEvent.count({ where: { tenantId } }),
        prisma.tenantPolicy.count({ where: { tenantId } }),
      ]),
    ]);
    if (!tenant || !request) throw new Error("Confirmed tenant deletion request is invalid");
    const deletedRecordCounts = {
      memberships: counts[0],
      messages: counts[1],
      auditEvents: counts[2],
      policies: counts[3],
    };
    const receipt = await prisma.$transaction(async (tx) => {
      const created = await tx.tenantDeletionReceipt.create({
        data: {
          tenantId,
          requestId,
          requestedByUserId: actorUserId,
          tenantNameHash: createHash("sha256").update(tenant.name).digest("hex"),
          deletedRecordCounts,
        },
      });
      await tx.tenant.delete({ where: { id: tenantId } });
      return created;
    });

    const exportKeys = jobs.flatMap((job) => {
      const result = job.result;
      return result && typeof result === "object" && !Array.isArray(result)
        && typeof result.storageKey === "string" ? [result.storageKey] : [];
    });
    await Promise.allSettled([
      ...attachmentRows.map((attachment) => attachmentStorage.delete(attachment.storageKey)),
      ...exportKeys.map((storageKey) => exportStorage.delete(storageKey)),
    ]);
    return { receiptId: receipt.id, deletedAt: receipt.deletedAt, deletedRecordCounts };
  }
}
export const jobService = new JobService();
