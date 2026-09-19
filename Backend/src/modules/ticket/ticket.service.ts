import type { MembershipRole, PlatformRole, Prisma, TicketSeverity, TicketStatus, TicketCategory } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
// Response targets live in sla.ts because two of the four are counted in
// business time, which is a calendar problem rather than a ticket one.
import { slaFor, SEVERITY_RESPONSE_TARGET } from "./sla.js";


interface TenantCaller {
  kind: "tenant";
  tenantId: string;
  userId: string;
  membershipId: string;
  role: MembershipRole;
  platformRole: PlatformRole;
}

interface StaffCaller {
  kind: "staff";
  userId: string;
  platformRole: PlatformRole;
  membershipId?: string;
}

const AUTHOR_SELECT = { select: { id: true, email: true, displayName: true } } as const;

export const TICKET_INCLUDE = {
  tenant: { select: { id: true, name: true, status: true } },
  openedBy: AUTHOR_SELECT,
  assignedStaff: AUTHOR_SELECT,
  comments: {
    include: { author: AUTHOR_SELECT },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.SupportTicketInclude;

const isStaffRole = (platformRole: PlatformRole | string | null | undefined) =>
  platformRole === "SUPPORT" || platformRole === "SUPER_ADMIN";

export class TicketService {
  // -------------------------------------------------------------------------
  // Tenant-facing (any ACTIVE member of the tenant).
  // -------------------------------------------------------------------------

  async listTenant(caller: TenantCaller, input: { status?: TicketStatus; q?: string; limit?: number }) {
    const where: Prisma.SupportTicketWhereInput = {
      tenantId: caller.tenantId,
      ...(caller.role === "MEMBER" ? { openedByUserId: caller.userId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.q && input.q.trim()
        ? { OR: [{ subject: { contains: input.q.trim(), mode: "insensitive" } }, { description: { contains: input.q.trim(), mode: "insensitive" } }] }
        : {}),
    };

    const [tickets, byStatus] = await Promise.all([
      prisma.supportTicket.findMany({ where, include: TICKET_INCLUDE, orderBy: { updatedAt: "desc" }, take: Math.min(input.limit ?? 50, 200) }),
      prisma.supportTicket.groupBy({ by: ["status"], where: { tenantId: caller.tenantId }, _count: true }),
    ]);

    return {
      ticketCounts: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      tickets: tickets.map((t) => serializeTicket(t)),
    };
  }

  async getTenantTicket(ticketId: string, caller: TenantCaller) {
    const ticket = await prisma.supportTicket.findFirst({ where: { id: ticketId, tenantId: caller.tenantId }, include: TICKET_INCLUDE });
    if (!ticket) throw new AppError("Ticket not found", 404, ErrorCodes.NOT_FOUND);
    if (caller.role === "MEMBER" && ticket.openedByUserId !== caller.userId) {
      throw new AppError("Insufficient permissions", 403, ErrorCodes.FORBIDDEN);
    }
    return serializeTicket(ticket, { includeInternal: isStaffRole(caller.platformRole) });
  }

  async createTenant(input: { subject: string; description: string; category: TicketCategory; severity: TicketSeverity }, caller: TenantCaller) {
    const ticket = await prisma.supportTicket.create({
      data: {
        tenantId: caller.tenantId,
        subject: input.subject,
        description: input.description,
        category: input.category,
        severity: input.severity,
        status: "OPEN",
        openedByUserId: caller.userId,
        openedByType: "TENANT",
        slaDueAt: slaFor(input.severity),
      },
      include: TICKET_INCLUDE,
    });
    await auditService.record({
      tenantId: caller.tenantId,
      actorUserId: caller.userId,
      eventType: "TICKET_OPENED",
      targetType: "SupportTicket",
      targetId: ticket.id,
      metadata: { subject: ticket.subject, category: ticket.category, severity: ticket.severity, source: "tenant" },
    });
    return serializeTicket(ticket);
  }

  async commentTenant(ticketId: string, body: string, caller: TenantCaller) {
    const ticket = await prisma.supportTicket.findFirst({ where: { id: ticketId, tenantId: caller.tenantId }, select: { id: true, status: true, openedByUserId: true } });
    if (!ticket) throw new AppError("Ticket not found", 404, ErrorCodes.NOT_FOUND);
    if (ticket.status === "CLOSED") throw new AppError("This ticket is closed", 409, ErrorCodes.CONFLICT);
    if (caller.role === "MEMBER" && ticket.openedByUserId !== caller.userId) {
      throw new AppError("Insufficient permissions", 403, ErrorCodes.FORBIDDEN);
    }

    const comment = await prisma.supportTicketComment.create({
      data: { ticketId, authorUserId: caller.userId, authorType: "TENANT", body },
      include: { author: AUTHOR_SELECT },
    });
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
    await auditService.record({
      tenantId: caller.tenantId,
      actorUserId: caller.userId,
      eventType: "TICKET_COMMENTED",
      targetType: "SupportTicket",
      targetId: ticketId,
      metadata: { authorType: "TENANT", commentId: comment.id },
    });
    return serializeComment(comment);
  }

  // -------------------------------------------------------------------------
  // Staff-facing (platform support console).
  // -------------------------------------------------------------------------

  async listPlatform(input: { tenantId?: string; status?: TicketStatus; severity?: TicketSeverity; assigned?: string; q?: string; limit?: number }) {
    const where: Prisma.SupportTicketWhereInput = {
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.severity ? { severity: input.severity } : {}),
      ...(input.q && input.q.trim()
        ? {
            OR: [
              { subject: { contains: input.q.trim(), mode: "insensitive" } },
              { description: { contains: input.q.trim(), mode: "insensitive" } },
              { tenant: { name: { contains: input.q.trim(), mode: "insensitive" } } },
              { openedBy: { email: { contains: input.q.trim(), mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    if (input.assigned === "unassigned") where.assignedStaffId = null;

    const tickets = await prisma.supportTicket.findMany({
      where,
      include: TICKET_INCLUDE,
      orderBy: { updatedAt: "desc" },
      take: Math.min(input.limit ?? 50, 200),
    });

    return { tickets: tickets.map((t) => serializeTicket(t, { includeInternal: true })) };
  }

  async listPlatformMine(caller: StaffCaller) {
    const tickets = await prisma.supportTicket.findMany({
      where: { assignedStaffId: caller.userId },
      include: TICKET_INCLUDE,
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return { tickets: tickets.map((t) => serializeTicket(t, { includeInternal: true })) };
  }

  async getPlatformTicket(ticketId: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId }, include: TICKET_INCLUDE });
    if (!ticket) throw new AppError("Ticket not found", 404, ErrorCodes.NOT_FOUND);
    return serializeTicket(ticket, { includeInternal: true });
  }

  async createPlatform(
    input: { tenantId: string; subject: string; description: string; category: TicketCategory; severity: TicketSeverity; assignedStaffId?: string | null },
    caller: StaffCaller,
  ) {
    const tenant = await prisma.tenant.findFirst({ where: { id: input.tenantId } });
    if (!tenant) throw new AppError("Tenant not found", 404, ErrorCodes.NOT_FOUND);
    if (input.assignedStaffId) await this.assertStaff(input.assignedStaffId);

    const ticket = await prisma.supportTicket.create({
      data: {
        tenantId: input.tenantId,
        subject: input.subject,
        description: input.description,
        category: input.category,
        severity: input.severity,
        status: "OPEN",
        openedByUserId: caller.userId,
        openedByType: "STAFF",
        assignedStaffId: input.assignedStaffId ?? null,
        slaDueAt: slaFor(input.severity),
      },
      include: TICKET_INCLUDE,
    });
    await auditService.record({
      tenantId: input.tenantId,
      actorUserId: caller.userId,
      eventType: "TICKET_OPENED",
      targetType: "SupportTicket",
      targetId: ticket.id,
      metadata: { subject: ticket.subject, category: ticket.category, severity: ticket.severity, source: "support-console" },
    });
    return serializeTicket(ticket, { includeInternal: true });
  }

  async updatePlatform(
    ticketId: string,
    patch: { status?: TicketStatus; severity?: TicketSeverity; assignedStaffId?: string | null },
    caller: StaffCaller,
  ) {
    const current = await prisma.supportTicket.findUnique({ where: { id: ticketId }, include: TICKET_INCLUDE });
    if (!current) throw new AppError("Ticket not found", 404, ErrorCodes.NOT_FOUND);
    if (patch.assignedStaffId) await this.assertStaff(patch.assignedStaffId);

    const data: Prisma.SupportTicketUncheckedUpdateInput = {};
    const audit: Array<{ eventType: string; metadata: Prisma.InputJsonValue }> = [];
    let changed = false;

    if (patch.severity && patch.severity !== current.severity) {
      data.severity = patch.severity;
      data.slaDueAt = slaFor(patch.severity);
      audit.push({ eventType: "TICKET_SEVERITY_UPDATED", metadata: { from: current.severity, to: patch.severity } });
      changed = true;
    }
    if (patch.status && patch.status !== current.status) {
      data.status = patch.status;
      if (patch.status === "RESOLVED") data.resolvedAt = new Date();
      if (patch.status === "CLOSED") data.closedAt = new Date();
      if (patch.status === "OPEN" || patch.status === "IN_PROGRESS" || patch.status === "WAITING_TENANT") {
        data.resolvedAt = null;
        data.closedAt = null;
      }
      audit.push({ eventType: "TICKET_STATUS_UPDATED", metadata: { from: current.status, to: patch.status } });
      changed = true;
    }
    if (patch.assignedStaffId !== undefined && patch.assignedStaffId !== current.assignedStaffId) {
      if (patch.assignedStaffId === null) {
        data.assignedStaffId = null;
        audit.push({ eventType: "TICKET_UNASSIGNED", metadata: {} });
      } else {
        data.assignedStaffId = patch.assignedStaffId;
        audit.push({ eventType: "TICKET_ASSIGNED", metadata: { to: patch.assignedStaffId } });
      }
      changed = true;
    }

    if (!changed) return serializeTicket(current, { includeInternal: true });

    const ticket = await prisma.supportTicket.update({ where: { id: ticketId }, data, include: TICKET_INCLUDE });
    for (const a of audit) {
      await auditService.record({
        tenantId: ticket.tenantId,
        actorUserId: caller.userId,
        eventType: a.eventType,
        targetType: "SupportTicket",
        targetId: ticketId,
        metadata: a.metadata,
      });
    }
    return serializeTicket(ticket, { includeInternal: true });
  }

  async commentPlatform(ticketId: string, body: string, internal: boolean, caller: StaffCaller) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true, status: true, tenantId: true } });
    if (!ticket) throw new AppError("Ticket not found", 404, ErrorCodes.NOT_FOUND);
    if (ticket.status === "CLOSED") throw new AppError("This ticket is closed", 409, ErrorCodes.CONFLICT);

    const comment = await prisma.supportTicketComment.create({
      data: { ticketId, authorUserId: caller.userId, authorType: "STAFF", body, internal },
      include: { author: AUTHOR_SELECT },
    });
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
    await auditService.record({
      tenantId: ticket.tenantId,
      actorUserId: caller.userId,
      eventType: "TICKET_COMMENTED",
      targetType: "SupportTicket",
      targetId: ticketId,
      metadata: { authorType: "STAFF", internal, commentId: comment.id },
    });
    return serializeComment(comment);
  }

  async listStaff() {
    const staff = await prisma.appUser.findMany({
      where: { platformRole: { in: ["SUPPORT", "SUPER_ADMIN"] }, status: "ACTIVE" },
      select: { id: true, email: true, displayName: true },
      orderBy: { displayName: "asc" },
    });
    return { staff };
  }

  private async assertStaff(userId: string) {
    const user = await prisma.appUser.findFirst({ where: { id: userId, platformRole: { in: ["SUPPORT", "SUPER_ADMIN"] }, status: "ACTIVE" } });
    if (!user) throw new AppError("Assigned staff member not found", 400, ErrorCodes.VALIDATION_ERROR);
  }
}

function serializeTicket(
  ticket: Prisma.SupportTicketGetPayload<{ include: typeof TICKET_INCLUDE }>,
  opts: { includeInternal?: boolean } = {},
) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    tenantId: ticket.tenantId,
    tenantName: ticket.tenant.name,
    subject: ticket.subject,
    description: ticket.description,
    category: ticket.category,
    severity: ticket.severity,
    status: ticket.status,
    openedBy: ticket.openedBy ? { id: ticket.openedBy.id, email: ticket.openedBy.email, displayName: ticket.openedBy.displayName } : null,
    openedByType: ticket.openedByType,
    assignedStaff: ticket.assignedStaff
      ? { id: ticket.assignedStaff.id, email: ticket.assignedStaff.email, displayName: ticket.assignedStaff.displayName }
      : null,
    slaDueAt: ticket.slaDueAt,
    // The target in the runbook's own words, so a queue can show "15 minutes"
    // beside a due time instead of leaving the reader to infer the promise
    // from the clock. Derived rather than stored: changing §5 should change
    // what every open ticket claims, not only the ones raised afterwards.
    slaTarget: SEVERITY_RESPONSE_TARGET[ticket.severity],
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    comments: (ticket.comments ?? [])
      .filter((c) => (opts.includeInternal ? true : !c.internal))
      .map((c) => serializeComment(c)),
  };
}

function serializeComment(comment: { id: string; authorType: string; internal?: boolean; body: string; createdAt: Date; updatedAt: Date; author?: { id: string; email: string; displayName: string } | null }) {
  return {
    id: comment.id,
    authorType: comment.authorType,
    internal: Boolean(comment.internal),
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    author: comment.author ?? null,
  };
}

export const ticketService = new TicketService();