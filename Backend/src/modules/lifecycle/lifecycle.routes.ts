import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { jobService } from "../job/job.service.js";
import { exportStorage } from "./export.storage.js";
export const lifecycleRouter = Router();
const body = z.object({ idempotencyKey: z.string().trim().min(8).max(120), reason: z.string().trim().min(3).max(500).optional() });
const params = z.object({ requestId: z.string().uuid() });
const confirmDeletionBody = z.object({
  confirmation: z.literal("DELETE_TENANT_PERMANENTLY"),
  tenantName: z.string().trim().min(1).max(200),
});
lifecycleRouter.use(authenticate, tenantContext, requireRole("OWNER"));
lifecycleRouter.get("/", asyncHandler(async (req, res) => { sendSuccess(res, 200, { requests: await prisma.dataLifecycleRequest.findMany({ where: { tenantId: req.tenantContext!.tenantId }, include: { job: true }, orderBy: { createdAt: "desc" } }) }, req.requestId); }));
lifecycleRouter.post("/exports", validate(body), asyncHandler(async (req, res) => {
  const c=req.tenantContext!;
  const result=await prisma.$transaction(async tx => {
    const job=await jobService.enqueue({ tenantId:c.tenantId,userId:c.userId,type:"DATA_EXPORT",payload:{scope:"TENANT"},idempotencyKey:`export:${req.body.idempotencyKey}` },tx);
    const existing=await tx.dataLifecycleRequest.findFirst({where:{tenantId:c.tenantId,jobId:job.id}});
    if(existing)return {request:existing,job};
    const request=await tx.dataLifecycleRequest.create({data:{tenantId:c.tenantId,requestedByUserId:c.userId,type:"EXPORT",status:"APPROVED",approvedAt:new Date(),jobId:job.id,reason:req.body.reason}});
    await auditService.record({tenantId:c.tenantId,actorUserId:c.userId,eventType:"DATA_EXPORT_REQUESTED",targetType:"DataLifecycleRequest",targetId:request.id},tx);
    return {request,job};
  }); sendSuccess(res,202,result,req.requestId);
}));
lifecycleRouter.get("/exports/:requestId/download", validate(params, "params"), asyncHandler(async (req, res) => {
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
lifecycleRouter.post("/deletions", validate(body), asyncHandler(async (req,res)=>{const c=req.tenantContext!;const request=await prisma.dataLifecycleRequest.create({data:{tenantId:c.tenantId,requestedByUserId:c.userId,type:"DELETION",reason:req.body.reason}});await auditService.record({tenantId:c.tenantId,actorUserId:c.userId,eventType:"DATA_DELETION_REQUESTED",targetType:"DataLifecycleRequest",targetId:request.id});sendSuccess(res,202,request,req.requestId);}));
lifecycleRouter.post("/:requestId/approve",validate(params,"params"),asyncHandler(async(req,res)=>{const c=req.tenantContext!;const item=await prisma.dataLifecycleRequest.findFirst({where:{id:String(req.params.requestId),tenantId:c.tenantId,type:"DELETION",status:"REQUESTED"}});if(!item)throw new AppError("Deletion request not found",404,ErrorCodes.NOT_FOUND);const result=await prisma.$transaction(async tx=>{const job=await jobService.enqueue({tenantId:c.tenantId,userId:c.userId,type:"DATA_DELETION",payload:{requestId:item.id},idempotencyKey:`deletion:${item.id}`},tx);const request=await tx.dataLifecycleRequest.update({where:{id:item.id,tenantId:c.tenantId},data:{status:"APPROVED",approvedAt:new Date(),jobId:job.id}});await auditService.record({tenantId:c.tenantId,actorUserId:c.userId,eventType:"DATA_DELETION_APPROVED",targetType:"DataLifecycleRequest",targetId:item.id},tx);return{request,job};});sendSuccess(res,202,result,req.requestId);}));
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
      status: "APPROVED",
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
