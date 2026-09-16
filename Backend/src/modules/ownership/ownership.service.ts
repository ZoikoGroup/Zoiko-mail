import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";

/**
 * Two-person ownership transfer.
 *
 * The destructive-direction control for the membership module. Ownership never
 * changes hands on one person's say-so: an Owner initiates (PENDING), and a
 * *different* Owner approves. Approval executes the swap — the initiator is
 * demoted to ADMIN and the target promoted to OWNER — in a single transaction,
 * leaving the tenant with exactly one Owner. `tenantContext` reads the role
 * from the membership row on every request, so the swap takes effect on the
 * parties' next call with no token surgery.
 */
const TRANSFER_INCLUDE = {
  initiator: { select: { id: true, email: true, displayName: true } },
  approvedBy: { select: { id: true, email: true, displayName: true } },
  targetMembership: {
    include: { user: { select: { id: true, email: true, displayName: true } } },
  },
} satisfies Prisma.OwnershipTransferInclude;

export class OwnershipService {
  list(tenantId: string) {
    return prisma.ownershipTransfer.findMany({
      where: { tenantId },
      include: TRANSFER_INCLUDE,
      orderBy: [{ createdAt: "desc" }],
    });
  }

  async initiate(tenantId: string, initiatorUserId: string, targetMembershipId: string) {
    const target = await prisma.tenantMembership.findFirst({
      where: { id: targetMembershipId, tenantId, status: "ACTIVE" },
      include: { user: { select: { id: true, email: true, displayName: true } } },
    });
    if (!target) {
      throw new AppError("Active membership not found", 404, ErrorCodes.NOT_FOUND);
    }
    if (target.role === "OWNER") {
      throw new AppError("That member already owns the workspace", 400, ErrorCodes.VALIDATION_ERROR);
    }
    if (target.userId === initiatorUserId) {
      throw new AppError("You cannot transfer ownership to yourself", 400, ErrorCodes.VALIDATION_ERROR);
    }
    const open = await prisma.ownershipTransfer.findFirst({
      where: { tenantId, status: "PENDING" },
      select: { id: true },
    });
    if (open) {
      throw new AppError("An ownership transfer is already pending approval", 409, ErrorCodes.CONFLICT);
    }

    const transfer = await prisma.ownershipTransfer.create({
      data: { tenantId, initiatorUserId, targetMembershipId },
      include: TRANSFER_INCLUDE,
    });
    await auditService.record({
      tenantId, actorUserId: initiatorUserId,
      eventType: "OWNERSHIP_TRANSFER_REQUESTED",
      targetType: "OwnershipTransfer", targetId: transfer.id,
      metadata: { targetUserId: target.userId, targetEmail: target.user.email },
    });
    return transfer;
  }

  async approve(tenantId: string, approverUserId: string, transferId: string) {
    const transfer = await prisma.ownershipTransfer.findFirst({
      where: { id: transferId, tenantId, status: "PENDING" },
      include: {
        targetMembership: {
          include: { user: { select: { id: true, email: true, displayName: true } } },
        },
      },
    });
    if (!transfer) {
      throw new AppError("Pending ownership transfer not found", 404, ErrorCodes.NOT_FOUND);
    }
    if (transfer.initiatorUserId === approverUserId) {
      throw new AppError("A second Owner must approve the transfer; you cannot approve your own request", 400, ErrorCodes.VALIDATION_ERROR);
    }
    if (transfer.targetMembership.userId === approverUserId) {
      throw new AppError("The transfer target cannot approve their own ownership transfer", 400, ErrorCodes.VALIDATION_ERROR);
    }

    const result = await prisma.$transaction(async (tx) => {
      const initiator = await tx.tenantMembership.findFirst({
        where: { tenantId, userId: transfer.initiatorUserId, status: "ACTIVE" },
        select: { id: true, role: true },
      });
      if (!initiator || initiator.role !== "OWNER") {
        throw new AppError("The initiator is no longer an active Owner", 409, ErrorCodes.CONFLICT);
      }
      const demoted = await tx.tenantMembership.update({
        where: { id: initiator.id },
        data: { role: "ADMIN" },
        select: { id: true },
      });
      const promoted = await tx.tenantMembership.update({
        where: { id: transfer.targetMembershipId, tenantId, status: "ACTIVE" },
        data: { role: "OWNER" },
        select: { id: true },
      });
      const done = await tx.ownershipTransfer.update({
        where: { id: transfer.id },
        data: { status: "COMPLETED", approvedByUserId: approverUserId, completedAt: new Date() },
      });
      await auditService.record({
        tenantId, actorUserId: approverUserId,
        eventType: "OWNERSHIP_TRANSFER_EXECUTED",
        targetType: "OwnershipTransfer", targetId: transfer.id,
        metadata: {
          fromUserId: transfer.initiatorUserId,
          toUserId: transfer.targetMembership.userId,
          toEmail: transfer.targetMembership.user.email,
          approvedByUserId: approverUserId,
        },
      }, tx);
      return { demoted, promoted, transfer: done };
    });
    return result;
  }

  async cancel(tenantId: string, userId: string, transferId: string) {
    const transfer = await prisma.ownershipTransfer.findFirst({
      where: { id: transferId, tenantId, status: "PENDING" },
    });
    if (!transfer) {
      throw new AppError("Pending ownership transfer not found", 404, ErrorCodes.NOT_FOUND);
    }
    if (transfer.initiatorUserId !== userId) {
      throw new AppError("Only the initiator can cancel a pending ownership transfer", 403, ErrorCodes.FORBIDDEN);
    }
    const cancelled = await prisma.ownershipTransfer.update({
      where: { id: transfer.id },
      data: { status: "CANCELLED" },
    });
    await auditService.record({
      tenantId, actorUserId: userId,
      eventType: "OWNERSHIP_TRANSFER_CANCELLED",
      targetType: "OwnershipTransfer", targetId: transfer.id,
    });
    return cancelled;
  }
}

export const ownershipService = new OwnershipService();