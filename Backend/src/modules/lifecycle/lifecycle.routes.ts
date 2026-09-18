import { Router } from "express";
import { z } from "zod";
import { authenticate, idempotency, requireCapability, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { jobService } from "../job/job.service.js";
import { exportStorage } from "./export.storage.js";
import { HARD_DELETE_SLA_DAYS, hardDeleteDeadlineFrom, lifecycleService } from "./lifecycle.service.js";
export const lifecycleRouter = Router();
// The body key predates API §7's header and fed the job queue's own
// deduplication. It stays accepted so existing clients keep working, but it is
// optional now: the header is required on every write, so demanding both would
// make callers say the same thing twice — and let them say two different
// things.
const body = z.object({
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});
const params = z.object({ requestId: z.string().uuid() });
/**
 * A deletion request names what it erases — the target_type of §6.14.
 *
 * TENANT keeps the two-step, name-confirmed path it always had. USER is
 * approval-gated in one step: it affects one person rather than everyone, and
 * it anonymizes rather than destroys.
 */
const deletionBody = body.extend({
  targetType: z
    .enum(["TENANT", "MAILBOX", "CONNECTED_ACCOUNT", "USER", "AI_OUTPUTS", "SYNCED_DATA"])
    .default("TENANT"),
  targetId: z.string().uuid().optional(),
});
const blockBody = z.object({
  // Free text, because the bases named in §6.14 (law, contract, fraud,
  // security, payment dispute, legal preservation) are categories rather than
  // an enumeration anyone can close.
  reason: z.string().trim().min(10).max(500),
});
const scheduleBody = z.object({ scheduledFor: z.coerce.date() });
const confirmDeletionBody = z.object({
  confirmation: z.literal("DELETE_TENANT_PERMANENTLY"),
  tenantName: z.string().trim().min(1).max(200),
});
/**
 * Owner-gated as a floor, with the export itself behind its capability.
 *
 * The matrix marks `data.export` STEP_UP, but this router gated on the role
 * alone — so the export ran without the fresh re-authentication AC-003
 * requires, and the capability layer's answer was simply never asked for.
 * The export routes below now ask.
 *
 * The deletion chain stays role-gated on purpose. `tenant.delete` is
 * TWO_PERSON in the matrix and two-person approval does not exist yet, so
 * routing it through the capability would resolve closed and make tenant
 * deletion impossible rather than safer. That is the same class of gap this
 * change closes for export, and it stays open until a second-approver
 * mechanism exists.
 */
lifecycleRouter.use(authenticate, tenantContext, requireRole("OWNER"), idempotency);
lifecycleRouter.get("/", asyncHandler(async (req, res) => { sendSuccess(res, 200, { requests: await prisma.dataLifecycleRequest.findMany({ where: { tenantId: req.tenantContext!.tenantId }, include: { job: true }, orderBy: { createdAt: "desc" } }) }, req.requestId); }));
lifecycleRouter.post("/exports", requireCapability("data.export"), validate(body), asyncHandler(async (req, res) => {
  const c=req.tenantContext!;
  const result=await prisma.$transaction(async tx => {
    const job=await jobService.enqueue({ tenantId:c.tenantId,userId:c.userId,type:"DATA_EXPORT",payload:{scope:"TENANT"},idempotencyKey:`export:${req.body.idempotencyKey ?? req.header("Idempotency-Key")}` },tx);
    const existing=await tx.dataLifecycleRequest.findFirst({where:{tenantId:c.tenantId,jobId:job.id}});
    if(existing)return {request:existing,job};
    const request=await tx.dataLifecycleRequest.create({data:{tenantId:c.tenantId,requestedByUserId:c.userId,type:"EXPORT",status:"APPROVED",approvedAt:new Date(),jobId:job.id,reason:req.body.reason}});
    await auditService.record({tenantId:c.tenantId,actorUserId:c.userId,eventType:"DATA_EXPORT_REQUESTED",targetType:"DataLifecycleRequest",targetId:request.id},tx);
    return {request,job};
  }); sendSuccess(res,202,result,req.requestId);
}));
lifecycleRouter.get("/exports/:requestId/download", requireCapability("data.export"), validate(params, "params"), asyncHandler(async (req, res) => {
  const context = req.tenantContext!;
  const item = await prisma.dataLifecycleRequest.findFirst({
    where: {
      id: String(req.params.requestId),
      tenantId: context.tenantId,
      type: "EXPORT",
      status: "COMPLETED",
    },
    include: { job: true },
  });
  const result = item?.job?.result;
  const storageKey = result && typeof result === "object" && !Array.isArray(result)
    && typeof result.storageKey === "string" ? result.storageKey : null;
  const fileName = result && typeof result === "object" && !Array.isArray(result)
    && typeof result.fileName === "string" ? result.fileName : "zoiko-mail-export.json";
  if (!storageKey) throw new AppError("Completed export not found", 404, ErrorCodes.NOT_FOUND);
  const data = await exportStorage.read(storageKey);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
  res.setHeader("Content-Length", data.length);
  res.status(200).send(data);
}));
lifecycleRouter.post("/deletions", validate(deletionBody), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const targetType = req.body.targetType as "TENANT" | "USER";
  // Refused rather than accepted and never run: a request for a target with no
  // executor would sit in the queue accruing an SLA it can never meet.
  lifecycleService.assertExecutableTarget(req.body.targetType);
  if (targetType !== "TENANT" && !req.body.targetId) {
    throw new AppError("A target id is required for this target type", 422, ErrorCodes.VALIDATION_ERROR);
  }
  // Anonymizing the acting Owner would remove the only account that can
  // administer the workspace, mid-request.
  if (targetType === "USER" && req.body.targetId === c.userId) {
    throw new AppError("Request your own deletion from another Owner", 422, ErrorCodes.VALIDATION_ERROR);
  }
  const request = await prisma.dataLifecycleRequest.create({
    data: {
      tenantId: c.tenantId,
      requestedByUserId: c.userId,
      type: "DELETION",
      targetType,
      targetId: targetType === "TENANT" ? null : req.body.targetId,
      reason: req.body.reason,
    },
  });
  await auditService.record({
    tenantId: c.tenantId,
    actorUserId: c.userId,
    eventType: "DATA_DELETION_REQUESTED",
    targetType: "DataLifecycleRequest",
    targetId: request.id,
    metadata: { deletionTargetType: targetType, deletionTargetId: request.targetId },
  });
  sendSuccess(res, 202, request, req.requestId);
}));
/**
 * Approval is also verification, which is where §6.14 starts the clock.
 *
 * The deadline is computed here and never read from the request body: "the
 * scheduler enforces 30 days" is only true if the server owns the number.
 */
lifecycleRouter.post("/:requestId/approve", validate(params, "params"), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const item = await prisma.dataLifecycleRequest.findFirst({
    where: { id: String(req.params.requestId), tenantId: c.tenantId, type: "DELETION", status: "REQUESTED" },
  });
  if (!item) throw new AppError("Deletion request not found", 404, ErrorCodes.NOT_FOUND);
  const verifiedAt = new Date();
  const hardDeleteDeadline = hardDeleteDeadlineFrom(verifiedAt);
  // A user anonymization is confirmed by the approval itself; a tenant erase
  // still needs its second, name-typed confirmation before the worker will
  // touch it.
  const confirmed = item.targetType === "USER";
  const result = await prisma.$transaction(async (tx) => {
    const job = await jobService.enqueue({
      tenantId: c.tenantId,
      userId: c.userId,
      type: "DATA_DELETION",
      payload: { requestId: item.id, ...(confirmed ? { confirmed: true } : {}) },
      idempotencyKey: `deletion:${item.id}`,
    }, tx);
    const request = await tx.dataLifecycleRequest.update({
      where: { id: item.id, tenantId: c.tenantId },
      data: {
        status: "APPROVED",
        approvedAt: verifiedAt,
        verifiedAt,
        hardDeleteDeadline,
        scheduledFor: verifiedAt,
        jobId: job.id,
      },
    });
    await auditService.record({
      tenantId: c.tenantId,
      actorUserId: c.userId,
      eventType: "DATA_DELETION_APPROVED",
      targetType: "DataLifecycleRequest",
      targetId: item.id,
      metadata: {
        verifiedAt: verifiedAt.toISOString(),
        hardDeleteDeadline: hardDeleteDeadline.toISOString(),
        slaDays: HARD_DELETE_SLA_DAYS,
      },
    }, tx);
    return { request, job };
  });
  sendSuccess(res, 202, result, req.requestId);
}));

/** SLA monitoring: what is late, what is close, what is lawfully held. */
lifecycleRouter.get("/sla", asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await lifecycleService.slaReport(req.tenantContext!.tenantId), req.requestId);
}));

lifecycleRouter.post("/:requestId/block", validate(params, "params"), validate(blockBody), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  sendSuccess(res, 200, await lifecycleService.block(c.tenantId, String(req.params.requestId), req.body.reason, c), req.requestId);
}));

lifecycleRouter.post("/:requestId/unblock", validate(params, "params"), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  sendSuccess(res, 200, await lifecycleService.unblock(c.tenantId, String(req.params.requestId), c), req.requestId);
}));

lifecycleRouter.post("/:requestId/schedule", validate(params, "params"), validate(scheduleBody), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  sendSuccess(res, 200, await lifecycleService.schedule(c.tenantId, String(req.params.requestId), req.body.scheduledFor, c), req.requestId);
}));
lifecycleRouter.post("/:requestId/confirm-deletion", validate(params, "params"), validate(confirmDeletionBody), asyncHandler(async (req, res) => {
  const context = req.tenantContext!;
  const tenant = await prisma.tenant.findFirst({ where: { id: context.tenantId }, select: { name: true } });
  if (!tenant || tenant.name !== req.body.tenantName) {
    throw new AppError("Tenant name confirmation does not match", 400, ErrorCodes.VALIDATION_ERROR);
  }
  const item = await prisma.dataLifecycleRequest.findFirst({
    where: {
      id: String(req.params.requestId),
      tenantId: context.tenantId,
      type: "DELETION",
      status: { in: ["APPROVED", "SCHEDULED"] },
      // The typed tenant name is what confirms a tenant erase. A user
      // anonymization has no equivalent second gate and does not come here.
      targetType: "TENANT",
    },
    include: { job: true },
  });
  if (!item?.job || item.job.status !== "PENDING") {
    throw new AppError("Approved deletion request not found", 404, ErrorCodes.NOT_FOUND);
  }
  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.backgroundJob.update({
      where: { id: item.job!.id, tenantId: context.tenantId },
      data: {
        payload: { requestId: item.id, confirmed: true },
        runAt: new Date(),
      },
    });
    const request = await tx.dataLifecycleRequest.update({
      where: { id: item.id, tenantId: context.tenantId },
      data: { status: "PROCESSING" },
    });
    await auditService.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      eventType: "DATA_DELETION_CONFIRMED",
      targetType: "DataLifecycleRequest",
      targetId: item.id,
    }, tx);
    return { request, job };
  });
  sendSuccess(res, 202, result, req.requestId);
}));
lifecycleRouter.post("/:requestId/cancel", validate(params, "params"), asyncHandler(async (req, res) => {
  const context = req.tenantContext!;
  const item = await prisma.dataLifecycleRequest.findFirst({
    where: {
      id: String(req.params.requestId),
      tenantId: context.tenantId,
      type: "DELETION",
      status: { in: ["REQUESTED", "APPROVED"] },
    },
    include: { job: true },
  });
  if (!item) throw new AppError("Cancellable deletion request not found", 404, ErrorCodes.NOT_FOUND);
  const cancelled = await prisma.$transaction(async (tx) => {
    if (item.job) {
      await tx.backgroundJob.updateMany({
        where: { id: item.job.id, tenantId: context.tenantId, status: "PENDING" },
        data: { status: "CANCELLED", completedAt: new Date() },
      });
    }
    const request = await tx.dataLifecycleRequest.update({
      where: { id: item.id, tenantId: context.tenantId },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    await auditService.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      eventType: "DATA_DELETION_CANCELLED",
      targetType: "DataLifecycleRequest",
      targetId: item.id,
    }, tx);
    return request;
  });
  sendSuccess(res, 200, cancelled, req.requestId);
}));
