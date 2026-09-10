import type { MailboxType, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";

/**
 * Shared and distribution mailboxes — Security §10 and §9.1.
 *
 * A shared mailbox belongs to the workspace, not to a person, which is why
 * `Mailbox.membershipId` had to become nullable: while it was NOT NULL every
 * mailbox was somebody's, and §10's "users must be assigned to a shared
 * mailbox before access" had nothing to attach an assignment to.
 *
 * Access is read from the database on every request rather than cached, which
 * is what makes §10's "removing user access must invalidate active shared
 * mailbox sessions" true by construction: the next request simply fails the
 * lookup. A cached grant would have needed an invalidation path to go wrong.
 */

/** The four separable permissions §10 requires. */
export interface MailboxPermissions {
  canRead: boolean;
  canSend: boolean;
  canManage: boolean;
  canAssign: boolean;
}

export type MailboxPermission = keyof MailboxPermissions;

interface ActorContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Types that are shared rather than personal. */
const SHARED_TYPES: MailboxType[] = ["SHARED", "DISTRIBUTION"];

const assigneeSelect = {
  id: true,
  membershipId: true,
  canRead: true,
  canSend: true,
  canManage: true,
  canAssign: true,
  createdAt: true,
  membership: {
    select: {
      id: true,
      role: true,
      status: true,
      user: { select: { id: true, email: true, displayName: true } },
    },
  },
} satisfies Prisma.MailboxAccessSelect;

export class SharedMailboxService {
  /** Every shared and distribution mailbox, with how many people can reach it. */
  async list(tenantId: string) {
    const mailboxes = await prisma.mailbox.findMany({
      where: { tenantId, type: { in: SHARED_TYPES } },
      select: {
        id: true,
        address: true,
        type: true,
        sendSuspendedAt: true,
        sendSuspensionReason: true,
        aiEnabled: true,
        createdAt: true,
        _count: { select: { access: true } },
      },
      orderBy: [{ type: "asc" }, { address: "asc" }],
    });

    return mailboxes.map((mailbox) => ({
      id: mailbox.id,
      address: mailbox.address,
      type: mailbox.type,
      memberCount: mailbox._count.access,
      status: mailbox.sendSuspendedAt ? "SUSPENDED" : "ACTIVE",
      sendSuspensionReason: mailbox.sendSuspensionReason,
      aiEnabled: mailbox.aiEnabled,
      createdAt: mailbox.createdAt,
    }));
  }

  async create(
    tenantId: string,
    input: { address: string; type: "SHARED" | "DISTRIBUTION" },
    context: ActorContext
  ) {
    const address = input.address.trim().toLowerCase();
    const clash = await prisma.mailbox.findFirst({
      where: { tenantId, address },
      select: { id: true },
    });
    if (clash) {
      throw new AppError("A mailbox with this address already exists", 409, ErrorCodes.CONFLICT);
    }

    // membershipId stays null: this mailbox has no single owner, which is the
    // whole distinction from a personal one.
    //
    // Selected rather than returned whole: storageUsed and storageLimit are
    // BigInt columns, and JSON.stringify throws on those. Every other mailbox
    // path converts them to Number; this one has no use for them, so it does
    // not ask for them.
    const mailbox = await prisma.mailbox.create({
      data: { tenantId, address, type: input.type },
      select: {
        id: true,
        tenantId: true,
        address: true,
        type: true,
        membershipId: true,
        aiEnabled: true,
        createdAt: true,
      },
    });

    await auditService.record({
      tenantId,
      actorUserId: context.userId,
      eventType: "SHARED_MAILBOX_CREATED",
      targetType: "Mailbox",
      targetId: mailbox.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { address: mailbox.address, type: mailbox.type },
    });

    return mailbox;
  }

  /** The mailbox, confirmed to be shared and to belong to this workspace. */
  private async sharedMailbox(tenantId: string, mailboxId: string) {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, tenantId, type: { in: SHARED_TYPES } },
      select: { id: true, address: true, type: true },
    });
    if (!mailbox) throw new AppError("Shared mailbox not found", 404, ErrorCodes.NOT_FOUND);
    return mailbox;
  }

  async assignees(tenantId: string, mailboxId: string) {
    await this.sharedMailbox(tenantId, mailboxId);
    return prisma.mailboxAccess.findMany({
      where: { tenantId, mailboxId },
      select: assigneeSelect,
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Grant or update one person's access.
   *
   * Upsert rather than create: re-assigning someone who already has access is
   * a permission change, not a duplicate, and returning 409 there would make
   * the obvious way to edit a grant an error.
   */
  async assign(
    tenantId: string,
    mailboxId: string,
    input: { membershipId: string } & Partial<MailboxPermissions>,
    context: ActorContext
  ) {
    const mailbox = await this.sharedMailbox(tenantId, mailboxId);

    const membership = await prisma.tenantMembership.findFirst({
      where: { id: input.membershipId, tenantId, status: "ACTIVE" },
      select: { id: true, user: { select: { email: true } } },
    });
    if (!membership) {
      throw new AppError("Active membership not found", 404, ErrorCodes.NOT_FOUND);
    }

    const permissions = {
      canRead: input.canRead ?? true,
      canSend: input.canSend ?? false,
      canManage: input.canManage ?? false,
      canAssign: input.canAssign ?? false,
    };

    const existing = await prisma.mailboxAccess.findUnique({
      where: { mailboxId_membershipId: { mailboxId, membershipId: input.membershipId } },
      select: { canRead: true, canSend: true, canManage: true, canAssign: true },
    });

    const access = await prisma.mailboxAccess.upsert({
      where: { mailboxId_membershipId: { mailboxId, membershipId: input.membershipId } },
      create: {
        tenantId,
        mailboxId,
        membershipId: input.membershipId,
        grantedByUserId: context.userId,
        ...permissions,
      },
      update: permissions,
      select: assigneeSelect,
    });

    // §10 requires assignment creation and removal to be audited. The previous
    // permissions go in too, so a widening is legible as one.
    await auditService.record({
      tenantId,
      actorUserId: context.userId,
      eventType: existing ? "SHARED_MAILBOX_ACCESS_CHANGED" : "SHARED_MAILBOX_ACCESS_GRANTED",
      targetType: "Mailbox",
      targetId: mailboxId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        address: mailbox.address,
        assignee: membership.user.email,
        before: existing ?? null,
        after: permissions,
      },
    });

    return access;
  }

  async unassign(
    tenantId: string,
    mailboxId: string,
    membershipId: string,
    context: ActorContext
  ) {
    const mailbox = await this.sharedMailbox(tenantId, mailboxId);
    const existing = await prisma.mailboxAccess.findUnique({
      where: { mailboxId_membershipId: { mailboxId, membershipId } },
      select: { id: true, membership: { select: { user: { select: { email: true } } } } },
    });
    if (!existing) throw new AppError("Assignment not found", 404, ErrorCodes.NOT_FOUND);

    await prisma.mailboxAccess.delete({ where: { id: existing.id } });

    await auditService.record({
      tenantId,
      actorUserId: context.userId,
      eventType: "SHARED_MAILBOX_ACCESS_REVOKED",
      targetType: "Mailbox",
      targetId: mailboxId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { address: mailbox.address, assignee: existing.membership.user.email },
    });

    return { revoked: true };
  }

  /**
   * The mailbox a request should act in, or a refusal.
   *
   * With an id this is a shared mailbox the caller must hold `permission` on.
   * A tenant Admin role does not grant it: §9 is explicit that a role check
   * and a mailbox-level check are different questions, and AC-005 turns on
   * the difference.
   */
  async resolveAccessibleMailbox(
    context: { tenantId: string; membershipId: string },
    mailboxId: string,
    permission: MailboxPermission
  ) {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, tenantId: context.tenantId },
      select: { id: true, address: true, type: true, membershipId: true, aiEnabled: true },
    });
    if (!mailbox) throw new AppError("Mailbox not found", 404, ErrorCodes.NOT_FOUND);

    // Your own mailbox needs no assignment.
    if (mailbox.membershipId && mailbox.membershipId === context.membershipId) return mailbox;

    const access = await prisma.mailboxAccess.findUnique({
      where: {
        mailboxId_membershipId: { mailboxId, membershipId: context.membershipId },
      },
      select: { canRead: true, canSend: true, canManage: true, canAssign: true },
    });

    // 404 rather than 403 for an unassigned caller: whether a particular
    // shared mailbox exists is itself information they have no claim to.
    if (!access) throw new AppError("Mailbox not found", 404, ErrorCodes.NOT_FOUND);

    if (!access[permission]) {
      const needed = permission.replace("can", "").toLowerCase();
      throw new AppError(
        `This mailbox is assigned to you without ${needed} permission`,
        403,
        ErrorCodes.FORBIDDEN,
        { mailboxId, permission }
      );
    }

    return mailbox;
  }
}

export const sharedMailboxService = new SharedMailboxService();
