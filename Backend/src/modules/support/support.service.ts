import type { MailFolder, PlatformRole, Prisma, SupportScope } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService, redactMetadata } from "../audit/audit.service.js";
import { redactSubject, restrictedMessageIds } from "./redaction.js";

const DELIVERY_ISSUE_TYPES = ["FAILED", "BOUNCED", "REJECTED", "BLOCKED"] as const;

/**
 * An incident named in the reason, for the case where no ticket exists yet.
 *
 * Deliberately loose — the point is that a human wrote down something that can
 * be looked up later, not that it matches one issue tracker's format.
 */
const NAMES_AN_INCIDENT = /\b(?:INC|INCIDENT|P0|P1|SEV[- ]?[0-3]|CASE)\b[- ]?\w*/i;

export class SupportService {
  /**
   * The console's landing screen.
   *
   * Reachable without a grant, because the console itself is — a member the
   * Owner invited as SUPPORT can open their workspace and see how it is
   * doing. But this method also reads audit events, recent messages and
   * delivery failures, which are the customer's records rather than a
   * health summary, so `investigative` decides whether those come back.
   *
   * Counts either way. A seat with no grant learns that eleven messages
   * failed yesterday; it does not learn who sent them. That is the line the
   * split between support.console.read and support.workspace.investigate
   * draws, applied inside the one endpoint that straddles it.
   */
  async overview(tenantId: string, investigative = true) {
    const since24h = new Date(Date.now() - 86_400_000);

    const [
      memberships,
      mailboxes,
      domains,
      grants,
      openCommitments,
      failedMessages,
      failedDeliveries,
      retryJobs,
      failedJobs,
      audit,
    ] = await Promise.all([
      prisma.tenantMembership.findMany({
        where: { tenantId, status: { in: ["ACTIVE", "INVITED"] } },
        include: {
          user: { select: { id: true, email: true, displayName: true, status: true, lastLoginAt: true, createdAt: true } },
          mailbox: { select: { id: true, address: true, createdAt: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.mailbox.count({ where: { tenantId } }),
      prisma.mailDomain.findMany({ where: { tenantId }, select: { id: true, domainName: true, verificationStatus: true, mxStatus: true, spfStatus: true, dkimStatus: true, dmarcStatus: true, lastCheckedAt: true } }),
      prisma.supportAccessGrant.findMany({
        where: { tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
        include: { supportMembership: { include: { user: { select: { id: true, email: true, displayName: true } } } }, approvedBy: { select: { id: true, email: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.commitment.count({ where: { tenantId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      prisma.emailMessage.findMany({
        where: { tenantId, status: "FAILED", updatedAt: { gte: since24h } },
        select: { id: true, subject: true, fromAddress: true, fromName: true, createdAt: true, updatedAt: true, scheduleLastError: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      prisma.deliveryEvent.findMany({
        where: { tenantId, type: { in: [...DELIVERY_ISSUE_TYPES] }, createdAt: { gte: since24h } },
        select: { id: true, type: true, failureCode: true, failureReason: true, createdAt: true, message: { select: { id: true, subject: true, fromAddress: true, fromName: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.backgroundJob.findMany({
        where: { tenantId, status: { in: ["RETRY", "PENDING", "RUNNING"] } },
        select: { id: true, type: true, status: true, lastError: true, updatedAt: true, createdAt: true },
        orderBy: { updatedAt: "desc" },
        take: 25,
      }),
      prisma.backgroundJob.findMany({
        where: { tenantId, status: "FAILED" },
        select: { id: true, type: true, status: true, lastError: true, updatedAt: true, createdAt: true },
        orderBy: { updatedAt: "desc" },
        take: 25,
      }),
      prisma.auditEvent.findMany({
        where: { tenantId },
        include: { actor: { select: { id: true, email: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    const deliveryCounts = await prisma.deliveryEvent.groupBy({
      by: ["type"],
      where: { tenantId, createdAt: { gte: since24h } },
      _count: true,
    });

    // Runbook §7 / Data Model: a subject "may be redacted by policy for
    // restricted mailboxes". Resolved once for the whole page rather than per
    // row — these lists carry up to fifty messages each.
    const restricted = await restrictedMessageIds([
      ...failedMessages.map((m) => m.id),
      ...failedDeliveries.map((e) => e.message?.id).filter((id): id is string => Boolean(id)),
    ]);

    const issues = [
      ...failedMessages.map((msg) => ({
        id: `MSG-${msg.id.slice(0, 8)}`,
        kind: "message" as const,
        subject: redactSubject(msg.subject, msg.id, restricted) || "(no subject)",
        customer: msg.fromName || msg.fromAddress || "Unknown",
        mailbox: msg.fromAddress ?? null,
        category: "Delivery",
        priority: "High",
        status: "Failed",
        error: msg.scheduleLastError ?? null,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
      })),
      ...failedDeliveries.map((ev) => ({
        id: `DLV-${ev.id.slice(0, 8)}`,
        kind: "delivery" as const,
        subject: redactSubject(ev.message?.subject, ev.message?.id, restricted) || "Delivery event",
        customer: ev.message?.fromName || ev.message?.fromAddress || "Unknown",
        mailbox: ev.message?.fromAddress ?? null,
        category: "Delivery",
        priority: "High",
        status: ev.type,
        error: ev.failureReason ?? ev.failureCode ?? null,
        createdAt: ev.createdAt,
        updatedAt: ev.createdAt,
      })),
      ...failedJobs.map((job) => ({
        id: `JOB-${job.id.slice(0, 8)}`,
        kind: "job" as const,
        subject: job.type.replace(/_/g, " ").toLowerCase(),
        customer: "System",
        mailbox: null,
        category: "Automation",
        priority: "Medium",
        status: job.status,
        error: job.lastError ?? null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      })),
    ]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 100);

    const members = memberships.map((m) => ({
      id: m.id,
      userId: m.user.id,
      name: m.user.displayName,
      email: m.user.email,
      role: m.role,
      status: m.status,
      userStatus: m.user.status,
      lastLoginAt: m.user.lastLoginAt,
      joinedAt: m.createdAt,
      mailboxes: m.mailbox ? [m.mailbox.address] : [],
    }));

    const team = memberships
      .filter((m) => m.role === "SUPPORT")
      .map((m) => ({
        id: m.id,
        userId: m.user.id,
        name: m.user.displayName,
        email: m.user.email,
        status: m.user.status,
      }));

    const stats = {
      tenantId,
      members: memberships.length,
      mailboxes,
      domains: domains.length,
      activeGrants: grants.length,
      openCommitments,
      issues: issues.length,
      failedMessages24h: failedMessages.length,
      failedDeliveries24h: failedDeliveries.length,
      retryJobs: retryJobs.length,
      failedJobs: failedJobs.length,
      deliveryEvents24h: deliveryCounts.reduce((sum, row) => sum + row._count, 0),
    };

    return {
      stats,
      domains,
      members: investigative ? members : [],
      team: investigative ? team : [],
      issues: investigative ? issues : [],
      audit: !investigative ? [] : audit.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        targetType: event.targetType,
        targetId: event.targetId,
        actor: event.actor ? { id: event.actor.id, email: event.actor.email, displayName: event.actor.displayName } : null,
        createdAt: event.createdAt,
      })),
      grants,
    };
  }
  list(tenantId: string) {
    return prisma.supportAccessGrant.findMany({
      where: { tenantId },
      include: { supportMembership: { include: { user: { select: { id: true, email: true, displayName: true } } } }, approvedBy: { select: { id: true, email: true, displayName: true } } },
      orderBy: { createdAt: "desc" },
    });
  }
  /**
   * Open support access to this workspace.
   *
   * Runbook §7 wants the access attributable: "linked to a ticket, incident,
   * or approved customer support request". A ticket id is the strong form and
   * is verified to belong to this workspace — a grant pointing at somebody
   * else's case is worse than no link at all. An incident reference written
   * into the reason is the weak form, allowed because a P0 can start before
   * anyone has raised a ticket. What is refused is the third case: an access
   * with neither, which nobody can account for afterwards.
   */
  async create(input: { supportMembershipId: string; reason: string; ticketId?: string; expiresInMinutes: number; scopes: SupportScope[] }, tenantId: string, userId: string) {
    const membership = await prisma.tenantMembership.findFirst({ where: { id: input.supportMembershipId, tenantId, role: "SUPPORT", status: "ACTIVE" } });
    if (!membership) throw new AppError("Active SUPPORT membership not found", 404, ErrorCodes.NOT_FOUND);

    if (input.ticketId) {
      const ticket = await prisma.supportTicket.findFirst({ where: { id: input.ticketId, tenantId }, select: { id: true } });
      if (!ticket) {
        throw new AppError("That ticket does not belong to this workspace", 404, ErrorCodes.NOT_FOUND);
      }
    } else if (!NAMES_AN_INCIDENT.test(input.reason)) {
      throw new AppError(
        "Link this access to a ticket, or name the incident it is for in the reason.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    await prisma.supportAccessGrant.updateMany({ where: { tenantId, supportMembershipId: membership.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
    const grant = await prisma.supportAccessGrant.create({ data: { tenantId, supportMembershipId: membership.id, approvedByUserId: userId, reason: input.reason, ticketId: input.ticketId ?? null, scopes: input.scopes, expiresAt: new Date(Date.now() + input.expiresInMinutes * 60_000) } });
    await auditService.record({ tenantId, actorUserId: userId, eventType: "SUPPORT_ACCESS_GRANTED",
      actorType: "SUPPORT", targetType: "SupportAccessGrant", targetId: grant.id, metadata: { scopes: grant.scopes, expiresAt: grant.expiresAt.toISOString(), reason: grant.reason, ticketId: grant.ticketId } });
    return grant;
  }
  /**
   * Support asking a workspace for access.
   *
   * Open to the SUPPORT seat itself and needs no grant, which is the point:
   * this is how the first grant comes into existence. Until it existed the
   * enforcement was real and unusable — nothing in the product could create a
   * grant, so the only way to open access was a direct API call.
   *
   * The same attribution rule as approving one (Runbook §7): a ticket in this
   * workspace, or an incident named in the reason. Asked for at request time
   * rather than at approval, so the approver decides on a case rather than
   * being asked to invent one.
   */
  async requestAccess(
    input: { reason: string; ticketId?: string; scopes: SupportScope[]; requestedMinutes: number },
    tenantId: string,
    membershipId: string,
    userId: string
  ) {
    await this.assertAttributable(input, tenantId);

    const existing = await prisma.supportAccessRequest.findFirst({
      where: { tenantId, supportMembershipId: membershipId, status: "PENDING" },
      select: { id: true },
    });
    if (existing) {
      throw new AppError("You already have a request waiting on this workspace.", 409, ErrorCodes.CONFLICT);
    }

    const request = await prisma.supportAccessRequest.create({
      data: {
        tenantId,
        supportMembershipId: membershipId,
        reason: input.reason,
        ticketId: input.ticketId ?? null,
        scopes: input.scopes,
        requestedMinutes: input.requestedMinutes,
      },
    });

    await auditService.record({
      tenantId, actorUserId: userId, actorType: "SUPPORT",
      eventType: "SUPPORT_ACCESS_REQUESTED",
      targetType: "SupportAccessRequest", targetId: request.id,
      metadata: {
        scopes: request.scopes,
        requestedMinutes: request.requestedMinutes,
        reason: request.reason,
        ticketId: request.ticketId,
      },
    });

    await this.notifyApprovers(tenantId, request.reason);
    return request;
  }

  /** Pending first, because that is the list anyone opens this screen for. */
  async listRequests(tenantId: string, status?: "PENDING" | "APPROVED" | "DENIED" | "WITHDRAWN") {
    return prisma.supportAccessRequest.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: {
        supportMembership: { include: { user: { select: { id: true, email: true, displayName: true } } } },
        decidedBy: { select: { id: true, email: true, displayName: true } },
        ticket: { select: { id: true, ticketNumber: true, subject: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
    });
  }

  /**
   * Approve a request, which is what actually writes the grant.
   *
   * The approver may shorten the window but never lengthen it, and the scopes
   * are the ones that were asked for. An approval that silently widened the
   * request would make the request a formality rather than the thing being
   * approved.
   */
  async approveRequest(
    requestId: string,
    tenantId: string,
    approverUserId: string,
    overrideMinutes?: number
  ) {
    const request = await prisma.supportAccessRequest.findFirst({
      where: { id: requestId, tenantId, status: "PENDING" },
    });
    if (!request) throw new AppError("Pending support access request not found", 404, ErrorCodes.NOT_FOUND);

    const minutes = Math.min(overrideMinutes ?? request.requestedMinutes, request.requestedMinutes);

    const grant = await this.create(
      {
        supportMembershipId: request.supportMembershipId,
        reason: request.reason,
        ticketId: request.ticketId ?? undefined,
        expiresInMinutes: minutes,
        scopes: request.scopes,
      },
      tenantId,
      approverUserId
    );

    const updated = await prisma.supportAccessRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", decidedByUserId: approverUserId, decidedAt: new Date(), grantId: grant.id },
    });

    await auditService.record({
      tenantId, actorUserId: approverUserId, actorType: "SUPPORT",
      eventType: "SUPPORT_ACCESS_REQUEST_APPROVED",
      targetType: "SupportAccessRequest", targetId: request.id,
      metadata: { grantId: grant.id, minutes, scopes: request.scopes },
    });

    await this.notifyRequester(request.supportMembershipId, tenantId, "approved", grant.expiresAt);
    return { request: updated, grant };
  }

  async denyRequest(requestId: string, tenantId: string, userId: string, note?: string) {
    const request = await prisma.supportAccessRequest.findFirst({
      where: { id: requestId, tenantId, status: "PENDING" },
    });
    if (!request) throw new AppError("Pending support access request not found", 404, ErrorCodes.NOT_FOUND);

    const updated = await prisma.supportAccessRequest.update({
      where: { id: request.id },
      data: { status: "DENIED", decidedByUserId: userId, decidedAt: new Date() },
    });

    await auditService.record({
      tenantId, actorUserId: userId, actorType: "SUPPORT",
      eventType: "SUPPORT_ACCESS_REQUEST_DENIED",
      targetType: "SupportAccessRequest", targetId: request.id,
      metadata: { note: note ?? null },
    });

    await this.notifyRequester(request.supportMembershipId, tenantId, "declined");
    return updated;
  }

  /** The requester changing their mind, which needs nobody's approval. */
  async withdrawRequest(requestId: string, tenantId: string, membershipId: string, userId: string) {
    const request = await prisma.supportAccessRequest.findFirst({
      where: { id: requestId, tenantId, supportMembershipId: membershipId, status: "PENDING" },
    });
    if (!request) throw new AppError("Pending support access request not found", 404, ErrorCodes.NOT_FOUND);

    const updated = await prisma.supportAccessRequest.update({
      where: { id: request.id },
      data: { status: "WITHDRAWN", decidedAt: new Date() },
    });
    await auditService.record({
      tenantId, actorUserId: userId, actorType: "SUPPORT",
      eventType: "SUPPORT_ACCESS_REQUEST_WITHDRAWN",
      targetType: "SupportAccessRequest", targetId: request.id,
    });
    return updated;
  }

  /** Runbook §7's attribution rule, shared by asking and by granting directly. */
  private async assertAttributable(
    input: { reason: string; ticketId?: string },
    tenantId: string
  ): Promise<void> {
    if (input.ticketId) {
      const ticket = await prisma.supportTicket.findFirst({
        where: { id: input.ticketId, tenantId },
        select: { id: true },
      });
      if (!ticket) throw new AppError("That ticket does not belong to this workspace", 404, ErrorCodes.NOT_FOUND);
      return;
    }
    if (!NAMES_AN_INCIDENT.test(input.reason)) {
      throw new AppError(
        "Link this access to a ticket, or name the incident it is for in the reason.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }
  }

  /**
   * Tell the people who can decide.
   *
   * ACTION_REQUIRED with a link, because a request that waits for somebody to
   * happen to open a screen is a request that expires unanswered — and the
   * support member is blocked for the whole of it.
   */
  private async notifyApprovers(tenantId: string, reason: string): Promise<void> {
    const approvers = await prisma.tenantMembership.findMany({
      where: { tenantId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
      select: { userId: true },
    });
    if (approvers.length === 0) return;
    await prisma.notification.createMany({
      data: approvers.map((a) => ({
        tenantId,
        userId: a.userId,
        type: "ACTION_REQUIRED" as const,
        title: "Support has asked for access to this workspace",
        body: reason.slice(0, 280),
        linkPath: "/owner/support-access",
      })),
    });
  }

  private async notifyRequester(
    supportMembershipId: string,
    tenantId: string,
    outcome: "approved" | "declined",
    expiresAt?: Date
  ): Promise<void> {
    const membership = await prisma.tenantMembership.findUnique({
      where: { id: supportMembershipId },
      select: { userId: true },
    });
    if (!membership) return;
    await prisma.notification.create({
      data: {
        tenantId,
        userId: membership.userId,
        type: outcome === "approved" ? "INFO" : "WARNING",
        title: "Support access " + outcome,
        body:
          outcome === "approved" && expiresAt
            ? "Your access is open until " + expiresAt.toISOString() + ". It ends on its own."
            : "Your request for access to this workspace was not granted.",
        linkPath: "/support",
      },
    });
  }

  async revoke(id: string, tenantId: string, userId: string) {
    const grant = await prisma.supportAccessGrant.findFirst({ where: { id, tenantId, revokedAt: null } });
    if (!grant) throw new AppError("Active support grant not found", 404, ErrorCodes.NOT_FOUND);
    const updated = await prisma.supportAccessGrant.update({ where: { id: grant.id, tenantId }, data: { revokedAt: new Date() } });
    await auditService.record({ tenantId, actorUserId: userId, eventType: "SUPPORT_ACCESS_REVOKED",
      actorType: "SUPPORT", targetType: "SupportAccessGrant", targetId: id });
    return updated;
  }
  async diagnostics(grantId: string | undefined, tenantId: string, membershipId: string, userId: string) {
    if (!grantId) throw new AppError("Support grant ID is required", 403, ErrorCodes.FORBIDDEN);
    const grant = await prisma.supportAccessGrant.findFirst({ where: { id: grantId, tenantId, supportMembershipId: membershipId, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (!grant) throw new AppError("Valid support access grant not found", 403, ErrorCodes.FORBIDDEN);
    const result: Record<string, unknown> = { grant: { id: grant.id, reason: grant.reason, scopes: grant.scopes, expiresAt: grant.expiresAt } };
    if (grant.scopes.includes("TENANT_DIAGNOSTICS")) {
      const [tenant, activeMembers, mailboxes] = await Promise.all([
        prisma.tenant.findFirst({ where: { id: tenantId }, select: { id: true, name: true, status: true, planCode: true, createdAt: true } }),
        prisma.tenantMembership.count({ where: { tenantId, status: "ACTIVE" } }),
        prisma.mailbox.count({ where: { tenantId } }),
      ]);
      result.tenant = { ...tenant, activeMembers, mailboxes };
    }
    if (grant.scopes.includes("DNS_DIAGNOSTICS")) result.domains = await prisma.mailDomain.findMany({ where: { tenantId }, select: { id: true, domainName: true, verificationStatus: true, mxStatus: true, spfStatus: true, dkimStatus: true, dmarcStatus: true, lastCheckedAt: true } });
    if (grant.scopes.includes("DELIVERY_DIAGNOSTICS")) result.delivery = await prisma.deliveryEvent.groupBy({ by: ["type"], where: { tenantId, createdAt: { gte: new Date(Date.now() - 86_400_000) } }, _count: true });
    if (grant.scopes.includes("AUDIT_READ")) result.audit = await prisma.auditEvent.findMany({ where: { tenantId }, select: { id: true, eventType: true, targetType: true, targetId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 });
    await auditService.record({ tenantId, actorUserId: userId, eventType: "SUPPORT_DIAGNOSTICS_ACCESSED",
      actorType: "SUPPORT", targetType: "SupportAccessGrant", targetId: grant.id, metadata: { scopes: grant.scopes } });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Platform support console (read-only operational investigation).
  // All responses stay tenant-scoped; privileged data requires a valid grant.
  // ---------------------------------------------------------------------------

  private issueRows = {
    message: "EmailMessage",
    delivery: "DeliveryEvent",
    job: "BackgroundJob",
    provider: "ProviderEvent",
    dns: "MailDomain",
    auth: "AuditEvent",
  } as const;

  async platformOverview() {
    const since24h = new Date(Date.now() - 86_400_000);

    const [activeTenants, tenantMembers, activeMailboxes, configuredDomains, failedSends24h, failedJobs, retryJobs, syncFailures24h, openTickets, overdueTickets, urgentTickets] =
      await Promise.all([
        prisma.tenant.count({ where: { status: "ACTIVE" } }),
        prisma.tenantMembership.count({ where: { status: { in: ["ACTIVE", "INVITED"] } } }),
        prisma.mailbox.count(),
        prisma.mailDomain.count(),
        prisma.emailMessage.count({ where: { status: "FAILED", updatedAt: { gte: since24h } } }),
        prisma.backgroundJob.count({ where: { status: "FAILED" } }),
        prisma.backgroundJob.count({ where: { status: "RETRY" } }),
        prisma.providerEvent.count({ where: { processingStatus: { in: ["FAILED", "DEAD_LETTER"] }, receivedAt: { gte: since24h } } }),
        prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_TENANT"] } } }),
        prisma.supportTicket.count({ where: { slaDueAt: { lt: new Date() }, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_TENANT"] } } }),
        prisma.supportTicket.count({ where: { severity: "URGENT", status: { in: ["OPEN", "IN_PROGRESS", "WAITING_TENANT"] } } }),
      ]);

    const [byProvider, byStatus, matrix] = await Promise.all([
      prisma.connectedAccount.groupBy({ by: ["provider"], _count: { _all: true } }),
      prisma.connectedAccount.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.connectedAccount.groupBy({ by: ["provider", "status"], _count: { _all: true } }),
    ]);

    const [failedMessages, failedDeliveries, failedBackgroundJobs, failedProviderEvents, dnsFailures, authFailures] =
      await Promise.all([
        prisma.emailMessage.findMany({
          where: { status: "FAILED", updatedAt: { gte: since24h } },
          select: { id: true, subject: true, fromAddress: true, fromName: true, scheduleLastError: true, createdAt: true, updatedAt: true, tenant: { select: { id: true, name: true } } },
          orderBy: { updatedAt: "desc" }, take: 40,
        }),
        prisma.deliveryEvent.findMany({
          where: { type: { in: [...DELIVERY_ISSUE_TYPES] }, createdAt: { gte: since24h } },
          select: { id: true, type: true, failureCode: true, failureReason: true, providerEventId: true, createdAt: true, tenantId: true, message: { select: { id: true, subject: true, fromAddress: true, fromName: true, tenant: { select: { id: true, name: true } } } } },
          orderBy: { createdAt: "desc" }, take: 40,
        }),
        prisma.backgroundJob.findMany({
          where: { status: "FAILED" },
          select: { id: true, type: true, status: true, lastError: true, createdAt: true, updatedAt: true, tenant: { select: { id: true, name: true } } },
          orderBy: { updatedAt: "desc" }, take: 40,
        }),
        prisma.providerEvent.findMany({
          where: { processingStatus: { in: ["FAILED", "DEAD_LETTER"] }, receivedAt: { gte: since24h } },
          select: { id: true, providerEventId: true, provider: true, eventType: true, processingStatus: true, errorCode: true, receivedAt: true, tenant: { select: { id: true, name: true } }, connectedAccount: { select: { email: true, provider: true } } },
          orderBy: { receivedAt: "desc" }, take: 40,
        }),
        prisma.mailDomain.findMany({
          where: { verificationStatus: "FAILED" },
          select: { id: true, domainName: true, verificationStatus: true, errorDetails: true, lastCheckedAt: true, updatedAt: true, tenant: { select: { id: true, name: true } } },
          orderBy: { updatedAt: "desc" }, take: 40,
        }),
        prisma.auditEvent.findMany({
          where: { eventType: { in: ["LOGIN_FAILED", "REFRESH_TOKEN_REUSE", "PASSWORD_RESET_REQUESTED"] }, createdAt: { gte: since24h } },
          select: { id: true, eventType: true, targetId: true, createdAt: true, tenant: { select: { id: true, name: true } }, actor: { select: { id: true, email: true, displayName: true } }, metadata: true },
          orderBy: { createdAt: "desc" }, take: 40,
        }),
      ]);

    // The same §7 rule as the tenant console, and it matters more here: this
    // view spans every workspace, so one restricted mailbox's subject line
    // would be readable by any staff member browsing the platform overview.
    const restricted = await restrictedMessageIds([
      ...failedMessages.map((m) => m.id),
      ...failedDeliveries.map((e) => e.message?.id).filter((id): id is string => Boolean(id)),
    ]);

    const issues = [
      ...failedMessages.map((m) => ({
        id: m.id, kind: "message" as const,
        tenantId: m.tenant.id, tenantName: m.tenant.name,
        resourceType: this.issueRows.message,
        resource: m.fromAddress ?? redactSubject(m.subject, m.id, restricted) ?? m.id.slice(0, 8),
        status: "FAILED", error: m.scheduleLastError ?? null, providerEventId: null, createdAt: m.updatedAt,
      })),
      ...failedDeliveries.map((e) => ({
        id: e.id, kind: "delivery" as const,
        tenantId: e.tenantId, tenantName: e.message?.tenant?.name ?? "Unknown",
        resourceType: this.issueRows.delivery,
        resource: `${e.message?.fromAddress ?? "unknown"} · ${redactSubject(e.message?.subject, e.message?.id, restricted) ?? "delivery event"}`,
        status: e.type, error: e.failureReason ?? e.failureCode ?? null,
        providerEventId: e.providerEventId ?? null, createdAt: e.createdAt,
      })),
      ...failedBackgroundJobs.map((j) => ({
        id: j.id, kind: "job" as const,
        tenantId: j.tenant.id, tenantName: j.tenant.name,
        resourceType: this.issueRows.job,
        resource: j.type.replace(/_/g, " ").toLowerCase(),
        status: j.status, error: j.lastError ?? null, providerEventId: null, createdAt: j.updatedAt,
      })),
      ...failedProviderEvents.map((p) => ({
        id: p.id, kind: "provider" as const,
        tenantId: p.tenant.id, tenantName: p.tenant.name,
        resourceType: this.issueRows.provider,
        resource: `${p.connectedAccount.email} (${p.provider})`,
        status: p.processingStatus, error: p.errorCode ?? p.eventType ?? null,
        providerEventId: p.providerEventId ?? null, createdAt: p.receivedAt,
      })),
      ...dnsFailures.map((d) => ({
        id: d.id, kind: "dns" as const,
        tenantId: d.tenant.id, tenantName: d.tenant.name,
        resourceType: this.issueRows.dns,
        resource: d.domainName,
        status: "FAILED",
        error: d.errorDetails ? JSON.stringify(d.errorDetails).slice(0, 240) : "Domain verification failed",
        providerEventId: null, createdAt: d.updatedAt,
      })),
      ...authFailures.map((a) => ({
        id: a.id, kind: "auth" as const,
        tenantId: a.tenant.id, tenantName: a.tenant.name,
        resourceType: this.issueRows.auth,
        resource: a.actor?.email ?? a.targetId ?? "account",
        status: a.eventType,
        error: (() => {
          const meta = redactMetadata(a.metadata) as Record<string, unknown> | null;
          if (meta && typeof meta === "object") return String(meta.reason ?? meta.message ?? "authentication event");
          return "authentication event";
        })(),
        providerEventId: null, createdAt: a.createdAt,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 100);

    return {
      stats: {
        activeTenants,
        tenantMembers,
        activeMailboxes,
        configuredDomains,
        providerAccounts: byProvider.reduce((sum, r) => sum + r._count._all, 0),
        failedSends24h,
        syncFailures24h,
        failedJobs,
        retryJobs,
      },
      ticketStats: {
        open: openTickets,
        overdue: overdueTickets,
        urgent: urgentTickets,
      },
      providerHealth: {
        byProvider: byProvider.map((r) => ({ provider: r.provider, count: r._count._all })),
        byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
        matrix: matrix.map((r) => ({ provider: r.provider, status: r.status, count: r._count._all })),
      },
      issues,
    };
  }

  async searchTenants(query: string, limit = 50) {
    const q = query.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
    const where: Prisma.TenantWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { memberships: { some: { user: { email: { contains: q, mode: "insensitive" } } } } },
            { mailboxes: { some: { address: { contains: q, mode: "insensitive" } } } },
            { domains: { some: { domainName: { contains: q, mode: "insensitive" } } } },
            ...(isUuid ? [{ id: { equals: q } }] : []),
          ],
        }
      : {};

    const tenants = await prisma.tenant.findMany({
      where,
      orderBy: { name: "asc" },
      take: Math.min(limit, 100),
      select: {
        id: true, name: true, status: true, planCode: true, createdAt: true,
        _count: { select: { memberships: true, mailboxes: true, domains: true, connectedAccounts: true } },
        connectedAccounts: { take: 1, orderBy: { updatedAt: "desc" }, select: { provider: true, status: true, lastErrorCode: true } },
      },
    });

    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      planCode: t.planCode,
      createdAt: t.createdAt,
      members: t._count.memberships,
      mailboxes: t._count.mailboxes,
      domains: t._count.domains,
      connectedAccounts: t._count.connectedAccounts,
      providerConnection: t.connectedAccounts[0] ?? null,
    }));
  }

  async searchMailboxes(query: string, limit = 50, tenantId?: string) {
    const q = query.trim();
    const where: Prisma.MailboxWhereInput = q
      ? {
          AND: [
            ...(tenantId ? [{ tenantId }] : []),
            {
              OR: [
                { address: { contains: q, mode: "insensitive" } },
                { tenant: { name: { contains: q, mode: "insensitive" } } },
                { membership: { user: { email: { contains: q, mode: "insensitive" } } } },
              ],
            },
          ],
        }
      : tenantId
        ? { tenantId }
        : {};

    const mailboxes = await prisma.mailbox.findMany({
      where,
      orderBy: { address: "asc" },
      take: Math.min(limit, 100),
      include: {
        tenant: { select: { id: true, name: true, status: true } },
        membership: { include: { user: { select: { id: true, email: true, displayName: true } }, connectedAccounts: { select: { id: true, provider: true, email: true, status: true, lastSyncedAt: true, lastErrorCode: true } } } },
      },
    });

    return mailboxes.map((m) => ({
      id: m.id,
      address: m.address,
      tenantId: m.tenant.id,
      tenantName: m.tenant.name,
      tenantStatus: m.tenant.status,
      // Null for a shared mailbox, which belongs to the workspace rather than
      // to a person. Support sees that as "no single owner" rather than a
      // blank name, which would read as missing data.
      memberName: m.membership?.user.displayName ?? null,
      memberEmail: m.membership?.user.email ?? null,
      mailboxType: m.type,
      suspended: m.sendSuspendedAt !== null,
      suspensionReason: m.sendSuspensionReason,
      createdAt: m.createdAt,
      connectedAccounts: m.membership?.connectedAccounts ?? [],
    }));
  }

  async searchDomains(query: string, limit = 50, tenantId?: string) {
    const q = query.trim();
    const where: Prisma.MailDomainWhereInput = q
      ? {
          AND: [
            ...(tenantId ? [{ tenantId }] : []),
            {
              OR: [
                { domainName: { contains: q, mode: "insensitive" } },
                { tenant: { name: { contains: q, mode: "insensitive" } } },
              ],
            },
          ],
        }
      : tenantId
        ? { tenantId }
        : {};

    const domains = await prisma.mailDomain.findMany({
      where,
      orderBy: { domainName: "asc" },
      take: Math.min(limit, 100),
      select: {
        id: true, domainName: true, verificationStatus: true, mxStatus: true, spfStatus: true, dkimStatus: true, dmarcStatus: true,
        lastCheckedAt: true, sendingEnabled: true, activatedAt: true,
        tenant: { select: { id: true, name: true } },
      },
    });
    return domains;
  }

  async tenantOverview(tenantId: string) {
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId },
      select: {
        id: true, name: true, status: true, planCode: true, timezone: true, createdAt: true, updatedAt: true,
        _count: { select: { memberships: true, mailboxes: true, domains: true, connectedAccounts: true, providerEvents: true, backgroundJobs: true, auditEvents: true } },
      },
    });
    if (!tenant) throw new AppError("Tenant not found", 404, ErrorCodes.NOT_FOUND);

    const [members, mailboxes, domains, connectedAccounts, providerEvents, deliveryEvents, jobs, audit, grants, suppressions] =
      await Promise.all([
        prisma.tenantMembership.findMany({
          where: { tenantId },
          include: { user: { select: { id: true, email: true, displayName: true, status: true, lastLoginAt: true } }, mailbox: { select: { id: true, address: true } } },
          orderBy: { createdAt: "asc" },
        }),
        prisma.mailbox.findMany({
          where: { tenantId },
          select: { id: true, address: true, sendSuspendedAt: true, sendSuspensionReason: true, createdAt: true, membershipId: true },
          orderBy: { address: "asc" },
        }),
        prisma.mailDomain.findMany({
          where: { tenantId },
          select: { id: true, domainName: true, verificationStatus: true, mxStatus: true, spfStatus: true, dkimStatus: true, dmarcStatus: true, lastCheckedAt: true, sendingEnabled: true, activatedAt: true },
          orderBy: { domainName: "asc" },
        }),
        prisma.connectedAccount.findMany({
          where: { tenantId },
          select: { id: true, provider: true, email: true, status: true, lastSyncedAt: true, lastErrorCode: true, createdAt: true, membershipId: true },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        prisma.providerEvent.findMany({
          where: { tenantId },
          include: { connectedAccount: { select: { email: true, provider: true, membershipId: true } } },
          orderBy: { receivedAt: "desc" },
          take: 25,
        }),
        prisma.deliveryEvent.findMany({
          where: { tenantId },
          select: {
            id: true,
            type: true,
            failureCode: true,
            failureReason: true,
            providerEventId: true,
            createdAt: true,
            message: {
              select: {
                subject: true,
                fromAddress: true,
                fromName: true,
                providerMessageId: true,
                status: true,
                recipients: { select: { email: true, type: true, deliveryStatus: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 25,
        }),
        prisma.backgroundJob.findMany({
          where: { tenantId, status: { in: ["PENDING", "RUNNING", "RETRY", "FAILED"] } },
          select: { id: true, type: true, status: true, attempts: true, maxAttempts: true, lastError: true, runAt: true, createdAt: true, updatedAt: true, payload: true },
          orderBy: { updatedAt: "desc" },
          take: 25,
        }),
        prisma.auditEvent.findMany({
          where: { tenantId },
          include: { actor: { select: { id: true, email: true, displayName: true } } },
          orderBy: { createdAt: "desc" },
          take: 40,
        }),
        prisma.supportAccessGrant.findMany({
          where: { tenantId },
          include: { supportMembership: { include: { user: { select: { id: true, email: true, displayName: true } } } }, approvedBy: { select: { id: true, email: true, displayName: true } } },
          orderBy: { createdAt: "desc" },
        }),
        prisma.suppressionEntry.findMany({
          where: { tenantId },
          select: { id: true, emailHash: true, reason: true, active: true, sourceEventId: true, createdAt: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 25,
        }),
      ]);

    const actorIds = [...new Set(audit.map((e) => e.actorUserId).filter((id): id is string => !!id))];
    const membershipRoles = await prisma.tenantMembership.findMany({
      where: { tenantId, userId: { in: actorIds } },
      select: { userId: true, role: true },
    });
    const roleByUser = new Map(membershipRoles.map((m) => [m.userId, m.role]));

    return {
      tenant,
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.user.displayName,
        email: m.user.email,
        role: m.role,
        status: m.status,
        userStatus: m.user.status,
        lastLoginAt: m.user.lastLoginAt,
        mailbox: m.mailbox?.address ?? null,
      })),
      mailboxes,
      domains,
      connectedAccounts,
      providerEvents: providerEvents.map((e) => ({
        id: e.id,
        providerEventId: e.providerEventId,
        provider: e.connectedAccount.provider,
        accountEmail: e.connectedAccount.email,
        eventType: e.eventType,
        processingStatus: e.processingStatus,
        errorCode: e.errorCode,
        attempts: e.attempts,
        receivedAt: e.receivedAt,
      })),
      deliveryEvents: deliveryEvents.map((e) => ({
        id: e.id,
        type: e.type,
        failureCode: e.failureCode,
        failureReason: e.failureReason,
        providerEventId: e.providerEventId,
        createdAt: e.createdAt,
        subject: e.message?.subject ?? null,
        fromAddress: e.message?.fromAddress ?? null,
        fromName: e.message?.fromName ?? null,
        providerMessageId: e.message?.providerMessageId ?? null,
        recipients: (e.message?.recipients ?? []).map((r) => ({ email: r.email, type: r.type, deliveryStatus: r.deliveryStatus })),
      })),
      jobs: jobs.map((j) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        attempts: j.attempts,
        maxAttempts: j.maxAttempts,
        lastError: j.lastError,
        runAt: j.runAt,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        resource: jobResource(j.payload),
      })),
      audit: audit.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actor: e.actor ? { id: e.actor.id, email: e.actor.email, displayName: e.actor.displayName } : null,
        actorRole: e.actorUserId ? (roleByUser.get(e.actorUserId) ?? null) : null,
        targetType: e.targetType,
        targetId: e.targetId,
        createdAt: e.createdAt,
        metadata: redactMetadata(e.metadata) as Prisma.JsonValue | null,
      })),
      grants: grants.map((g) => ({
        id: g.id,
        tenantId: g.tenantId,
        reason: g.reason,
        scopes: g.scopes,
        createdAt: g.createdAt,
        expiresAt: g.expiresAt,
        revokedAt: g.revokedAt,
        supportMember: g.supportMembership.user ? { id: g.supportMembership.user.id, email: g.supportMembership.user.email, displayName: g.supportMembership.user.displayName } : null,
        approvedBy: g.approvedBy ? { id: g.approvedBy.id, email: g.approvedBy.email, displayName: g.approvedBy.displayName } : null,
      })),
      suppressions,
    };
  }

  async domainDetail(tenantId: string, domainId: string) {
    const domain = await prisma.mailDomain.findFirst({
      where: { id: domainId, tenantId },
      select: {
        id: true, domainName: true, type: true, verificationToken: true, verificationStatus: true,
        mxStatus: true, spfStatus: true, dkimStatus: true, dmarcStatus: true,
        firstCheckedAt: true, lastCheckedAt: true, errorDetails: true, sendingEnabled: true, activatedAt: true, createdAt: true, updatedAt: true,
      },
    });
    if (!domain) throw new AppError("Domain not found", 404, ErrorCodes.NOT_FOUND);

    const checks = await prisma.domainDnsCheck.findMany({
      where: { tenantId, domainId },
      orderBy: { checkedAt: "desc" },
      take: 10,
      select: { id: true, verificationStatus: true, mxStatus: true, spfStatus: true, dkimStatus: true, dmarcStatus: true, errorDetails: true, checkedAt: true },
    });

    return {
      domain: { ...domain, errorDetails: domain.errorDetails ? JSON.stringify(domain.errorDetails) : null },
      checks,
    };
  }

  async mailboxDetail(tenantId: string, mailboxId: string) {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, tenantId },
      include: {
        membership: {
          include: {
            user: { select: { id: true, email: true, displayName: true, status: true, lastLoginAt: true } },
            connectedAccounts: { select: { id: true, provider: true, email: true, status: true, lastSyncedAt: true, lastErrorCode: true, createdAt: true, watchExpiresAt: true } },
          },
        },
      },
    });
    if (!mailbox) throw new AppError("Mailbox not found", 404, ErrorCodes.NOT_FOUND);

    const [syncJobs, providerEvents, deliveryEvents] = await Promise.all([
      prisma.backgroundJob.findMany({
        where: { tenantId, type: "IMAP_SYNC" },
        select: { id: true, type: true, status: true, attempts: true, maxAttempts: true, lastError: true, runAt: true, createdAt: true, updatedAt: true, payload: true },
        orderBy: { updatedAt: "desc" },
        take: 20,
      }),
      // A shared mailbox has no owning membership and so no connected
      // accounts; `none` keeps the query valid and returns an empty list
      // rather than silently matching every account in the tenant.
      prisma.providerEvent.findMany({
        where: mailbox.membershipId
          ? { tenantId, connectedAccount: { membershipId: mailbox.membershipId } }
          : { tenantId, id: { in: [] } },
        include: { connectedAccount: { select: { email: true, provider: true } } },
        orderBy: { receivedAt: "desc" },
        take: 20,
      }),
      prisma.deliveryEvent.findMany({
        where: { tenantId, message: { fromAddress: mailbox.address } },
        select: {
          id: true,
          type: true,
          failureCode: true,
          failureReason: true,
          providerEventId: true,
          createdAt: true,
          message: {
            select: {
              subject: true,
              fromAddress: true,
              fromName: true,
              providerMessageId: true,
              status: true,
              recipients: { select: { email: true, type: true, deliveryStatus: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    return {
      mailbox: {
        id: mailbox.id,
        address: mailbox.address,
        tenantId,
        sendSuspendedAt: mailbox.sendSuspendedAt,
        sendSuspensionReason: mailbox.sendSuspensionReason,
        createdAt: mailbox.createdAt,
        updatedAt: mailbox.updatedAt,
        type: mailbox.type,
        member: mailbox.membership?.user ?? null,
        connectedAccounts: mailbox.membership?.connectedAccounts ?? [],
      },
      syncJobs: syncJobs.map((j) => ({ id: j.id, type: j.type, status: j.status, attempts: j.attempts, maxAttempts: j.maxAttempts, lastError: j.lastError, runAt: j.runAt, createdAt: j.createdAt, updatedAt: j.updatedAt, resource: jobResource(j.payload) })),
      providerEvents: providerEvents.map((e) => ({ id: e.id, providerEventId: e.providerEventId, provider: e.connectedAccount.provider, accountEmail: e.connectedAccount.email, eventType: e.eventType, processingStatus: e.processingStatus, errorCode: e.errorCode, attempts: e.attempts, receivedAt: e.receivedAt })),
      deliveryEvents: deliveryEvents.map((e) => ({ id: e.id, type: e.type, failureCode: e.failureCode, failureReason: e.failureReason, providerEventId: e.providerEventId, createdAt: e.createdAt, subject: e.message?.subject ?? null, fromAddress: e.message?.fromAddress ?? null, fromName: e.message?.fromName ?? null, recipients: (e.message?.recipients ?? []).map((r) => ({ email: r.email, type: r.type, deliveryStatus: r.deliveryStatus })) })),
    };
  }

  async listProviderEvents(input: { tenantId?: string; provider?: string; status?: string; q?: string; limit?: number }) {
    const where: Prisma.ProviderEventWhereInput = {
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.provider ? { provider: input.provider as Prisma.ProviderEventWhereInput["provider"] } : {}),
      ...(input.status ? { processingStatus: input.status as Prisma.ProviderEventWhereInput["processingStatus"] } : {}),
      ...(input.q && input.q.trim()
        ? {
            OR: [
              { eventType: { contains: input.q.trim(), mode: "insensitive" } },
              { errorCode: { contains: input.q.trim(), mode: "insensitive" } },
              { providerEventId: { contains: input.q.trim(), mode: "insensitive" } },
              { connectedAccount: { email: { contains: input.q.trim(), mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const events = await prisma.providerEvent.findMany({
      where,
      include: {
        tenant: { select: { id: true, name: true } },
        connectedAccount: { select: { id: true, email: true, provider: true, status: true, membershipId: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: Math.min(input.limit ?? 50, 200),
    });

    return events.map((e) => ({
      id: e.id,
      providerEventId: e.providerEventId,
      tenantId: e.tenant.id,
      tenantName: e.tenant.name,
      provider: e.connectedAccount.provider,
      accountEmail: e.connectedAccount.email,
      accountStatus: e.connectedAccount.status,
      eventType: e.eventType,
      processingStatus: e.processingStatus,
      errorCode: e.errorCode,
      attempts: e.attempts,
      maxAttempts: e.maxAttempts,
      receivedAt: e.receivedAt,
      processedAt: e.processedAt,
      payload: redactMetadata(e.sanitizedPayload) as Prisma.JsonValue,
    }));
  }

  async listDeliveryEvents(input: { tenantId?: string; type?: string; q?: string; limit?: number }) {
    const where: Prisma.DeliveryEventWhereInput = {
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.type ? { type: input.type as Prisma.DeliveryEventWhereInput["type"] } : {}),
      ...(input.q && input.q.trim()
        ? {
            OR: [
              { failureCode: { contains: input.q.trim(), mode: "insensitive" } },
              { failureReason: { contains: input.q.trim(), mode: "insensitive" } },
              { providerEventId: { contains: input.q.trim(), mode: "insensitive" } },
              { message: { fromAddress: { contains: input.q.trim(), mode: "insensitive" } } },
              { message: { recipients: { some: { email: { contains: input.q.trim(), mode: "insensitive" } } } } },
            ],
          }
        : {}),
    };

    const events = await prisma.deliveryEvent.findMany({
      where,
      select: {
        id: true,
        type: true,
        tenantId: true,
        failureCode: true,
        failureReason: true,
        providerEventId: true,
        createdAt: true,
        message: {
          select: {
            id: true,
            subject: true,
            fromAddress: true,
            fromName: true,
            providerMessageId: true,
            status: true,
            createdAt: true,
            tenant: { select: { id: true, name: true } },
            recipients: { select: { email: true, type: true, deliveryStatus: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(input.limit ?? 50, 200),
    });

    // §7: a restricted mailbox's subject is not support's to read,
    // even on a delivery failure.
    const restricted = await restrictedMessageIds(
      events.map((e) => e.message?.id).filter((id): id is string => Boolean(id))
    );

    return events.map((e) => ({
      id: e.id,
      type: e.type,
      tenantId: e.message?.tenant?.id ?? e.tenantId,
      tenantName: e.message?.tenant?.name ?? "Unknown",
      failureCode: e.failureCode,
      failureReason: e.failureReason,
      providerEventId: e.providerEventId,
      createdAt: e.createdAt,
      message: e.message
        ? {
            subject: redactSubject(e.message.subject, e.message.id, restricted),
            fromAddress: e.message.fromAddress,
            fromName: e.message.fromName,
            providerMessageId: e.message.providerMessageId,
            status: e.message.status,
            createdAt: e.message.createdAt,
            recipients: e.message.recipients.map((r) => ({ email: r.email, type: r.type, deliveryStatus: r.deliveryStatus })),
          }
        : null,
    }));
  }

  async listJobs(input: { tenantId?: string; type?: string; status?: string; q?: string; limit?: number }) {
    const where: Prisma.BackgroundJobWhereInput = {
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.type ? { type: input.type as Prisma.BackgroundJobWhereInput["type"] } : {}),
      ...(input.status ? { status: input.status as Prisma.BackgroundJobWhereInput["status"] } : {}),
      ...(input.q && input.q.trim() ? { lastError: { contains: input.q.trim(), mode: "insensitive" } } : {}),
    };

    const jobs = await prisma.backgroundJob.findMany({
      where,
      include: { tenant: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
      take: Math.min(input.limit ?? 50, 200),
    });

    return jobs.map((j) => ({
      id: j.id,
      type: j.type,
      tenantId: j.tenant.id,
      tenantName: j.tenant.name,
      status: j.status,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      runAt: j.runAt,
      lockedAt: j.lockedAt,
      completedAt: j.completedAt,
      lastError: j.lastError,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      resource: jobResource(j.payload),
    }));
  }

  /**
   * Staff requeue of a terminal background job.
   *
   * Only a FAILED or CANCELLED job can be retried — a live or completed job is
   * in motion or done, and resurrecting it would be wrong. The reset clears
   * the failure state so the worker picks the job up as if new: attempts back
   * to zero, run time now, lock/error/completion cleared. The staff operator
   * is the actor, so there is no single tenant to inherit a grant from; the
   * event is attributed to the job's own tenant and the acting support user.
   */
  async requeue(jobId: string, actor: { userId: string; platformRole: PlatformRole }) {
    const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError("Job not found", 404, ErrorCodes.NOT_FOUND);
    if (job.status !== "FAILED" && job.status !== "CANCELLED") {
      throw new AppError(`Only failed or cancelled jobs can be retried (job is ${job.status})`, 409, ErrorCodes.CONFLICT);
    }

    const updated = await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { status: "PENDING", attempts: 0, runAt: new Date(), lockedAt: null, completedAt: null, lastError: null },
    });

    await auditService.record({
      tenantId: job.tenantId,
      actorUserId: actor.userId,
      eventType: "JOB_RETRIED",
      actorType: "SUPPORT",
      targetType: "BackgroundJob",
      targetId: jobId,
      metadata: { retriedByRole: actor.platformRole, source: "support-console" },
    });

    return updated;
  }

  async listGrants() {
    const grants = await prisma.supportAccessGrant.findMany({
      include: {
        tenant: { select: { id: true, name: true, status: true } },
        supportMembership: { include: { user: { select: { id: true, email: true, displayName: true } } } },
        approvedBy: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return grants.map((g) => ({
      id: g.id,
      tenantId: g.tenant.id,
      tenantName: g.tenant.name,
      tenantStatus: g.tenant.status,
      supportMembershipId: g.supportMembershipId,
      supportMember: g.supportMembership.user ? { id: g.supportMembership.user.id, email: g.supportMembership.user.email, displayName: g.supportMembership.user.displayName } : null,
      approvedBy: g.approvedBy ? { id: g.approvedBy.id, email: g.approvedBy.email, displayName: g.approvedBy.displayName } : null,
      reason: g.reason,
      scopes: g.scopes,
      createdAt: g.createdAt,
      expiresAt: g.expiresAt,
      revokedAt: g.revokedAt,
    }));
  }

  async revokeGrant(grantId: string, caller: { userId: string; membershipId?: string; platformRole: PlatformRole }) {
    const grant = await prisma.supportAccessGrant.findUnique({ where: { id: grantId } });
    if (!grant) throw new AppError("Support access grant not found", 404, ErrorCodes.NOT_FOUND);

    const isSuperAdmin = caller.platformRole === "SUPER_ADMIN";
    // Platform-token sessions (staff without a membership) have no
    // membershipId, so they can never match a grant's supportMembershipId and
    // are denied unless they are a SUPER_ADMIN.
    if (!isSuperAdmin && grant.supportMembershipId !== caller.membershipId) {
      throw new AppError("You may only revoke support grants assigned to your membership", 403, ErrorCodes.FORBIDDEN);
    }

    const updated = await prisma.supportAccessGrant.update({
      where: { id: grant.id },
      data: { revokedAt: new Date() },
    });

    await auditService.record({
      tenantId: grant.tenantId,
      actorUserId: caller.userId,
      eventType: "SUPPORT_ACCESS_REVOKED",
      actorType: "SUPPORT",
      targetType: "SupportAccessGrant",
      targetId: grant.id,
      metadata: { revokedByRole: "SUPPORT", source: "support-console" },
    });

    return updated;
  }

  async listSuppressions(input: { tenantId?: string; status?: string; limit?: number }) {
    // The platform console's "Active" filter sends status=true|false. Honor it
    // so staff can isolate active vs unsuppressed entries across tenants.
    const where: Prisma.SuppressionEntryWhereInput = {
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.status === "true" || input.status === "false" ? { active: input.status === "true" } : {}),
    };
    const entries = await prisma.suppressionEntry.findMany({
      where,
      include: { tenant: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
      take: Math.min(input.limit ?? 50, 200),
    });

    return entries.map((e) => ({
      id: e.id,
      tenantId: e.tenant.id,
      tenantName: e.tenant.name,
      emailHash: e.emailHash,
      reason: e.reason,
      active: e.active,
      sourceEventId: e.sourceEventId,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));
  }

  async listAudit(input: { tenantId?: string; q?: string; limit?: number }) {
    const where: Prisma.AuditEventWhereInput = {
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.q && input.q.trim()
        ? {
            OR: [
              { eventType: { contains: input.q.trim(), mode: "insensitive" } },
              { targetType: { contains: input.q.trim(), mode: "insensitive" } },
              { targetId: { contains: input.q.trim(), mode: "insensitive" } },
              { actor: { email: { contains: input.q.trim(), mode: "insensitive" } } },
              { actor: { displayName: { contains: input.q.trim(), mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const events = await prisma.auditEvent.findMany({
      where,
      include: {
        actor: { select: { id: true, email: true, displayName: true } },
        tenant: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(input.limit ?? 100, 200),
    });

    const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((id): id is string => !!id))];
    const tenantIds = [...new Set(events.map((e) => e.tenantId))];
    const memberships = await prisma.tenantMembership.findMany({
      where: { tenantId: { in: tenantIds }, userId: { in: actorIds } },
      select: { tenantId: true, userId: true, role: true },
    });
    const roleByKey = new Map(memberships.map((m) => [`${m.tenantId}:${m.userId}`, m.role]));

    return events.map((e) => {
      const meta = redactMetadata(e.metadata) as Record<string, unknown> | null;
      return {
        id: e.id,
        eventType: e.eventType,
        actor: e.actor ? { id: e.actor.id, email: e.actor.email, displayName: e.actor.displayName } : null,
        actorRole: e.actorUserId ? (roleByKey.get(`${e.tenantId}:${e.actorUserId}`) ?? null) : null,
        tenantId: e.tenant.id,
        tenantName: e.tenant.name,
        resource: e.targetType && e.targetId ? `${e.targetType} ${e.targetId.slice(0, 8)}` : (e.targetType ?? null),
        reason: meta && typeof meta === "object" ? (typeof meta.reason === "string" ? meta.reason : null) : null,
        result: meta && typeof meta === "object" ? (typeof meta.result === "string" || typeof meta.status === "string" ? String(meta.result ?? meta.status) : null) : null,
        requestId: e.requestId,
        ipAddress: e.ipAddress,
        userAgent: e.userAgent,
        metadata: meta,
        createdAt: e.createdAt,
      };
    });
  }

  /**
   * Fleet credential-health list backing the staff "Tokens" section.
   *
   * What §9 (and the runbook) forbid is surfacing OAuth secrets. OAuth access
   * and refresh tokens never live in this table — only a deterministic secret
   * reference does (schema note, Security §15) — so a deliberately narrow
   * select means not even the reference crosses the wire. Everything returned
   * here is lifecycle metadata: when each connection last synced, when its
   * token and webhook watch expire, and what the connector thinks is wrong.
   */
  async listTokens(input: { provider?: string; status?: string; q?: string; limit?: number }) {
    const where: Prisma.ConnectedAccountWhereInput = {
      ...(input.provider ? { provider: input.provider as Prisma.ConnectedAccountWhereInput["provider"] } : {}),
      ...(input.status ? { status: input.status as Prisma.ConnectedAccountWhereInput["status"] } : {}),
      ...(input.q && input.q.trim()
        ? {
            OR: [
              { email: { contains: input.q.trim(), mode: "insensitive" } },
              { providerAccountId: { contains: input.q.trim(), mode: "insensitive" } },
              { tenant: { name: { contains: input.q.trim(), mode: "insensitive" } } },
              { user: { email: { contains: input.q.trim(), mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const accounts = await prisma.connectedAccount.findMany({
      where,
      select: {
        id: true,
        tenantId: true,
        provider: true,
        providerAccountId: true,
        email: true,
        scopes: true,
        status: true,
        tokenExpiresAt: true,
        watchExpiresAt: true,
        lastSyncedAt: true,
        lastErrorCode: true,
        disconnectedAt: true,
        createdAt: true,
        updatedAt: true,
        tenant: { select: { id: true, name: true, status: true } },
        user: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(input.limit ?? 50, 200),
    });

    const now = Date.now();
    return accounts.map((a) => ({
      id: a.id,
      provider: a.provider,
      providerAccountId: a.providerAccountId,
      email: a.email,
      scopes: a.scopes,
      status: a.status,
      tenantId: a.tenant.id,
      tenantName: a.tenant.name,
      tenantStatus: a.tenant.status,
      owner: a.user ? { id: a.user.id, email: a.user.email, displayName: a.user.displayName } : null,
      tokenExpiresAt: a.tokenExpiresAt,
      watchExpiresAt: a.watchExpiresAt,
      lastSyncedAt: a.lastSyncedAt,
      lastErrorCode: a.lastErrorCode,
      disconnectedAt: a.disconnectedAt,
      reauthRequired: a.status === "REAUTH_REQUIRED" || Boolean(a.tokenExpiresAt && a.tokenExpiresAt.getTime() < now),
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));
  }

  async platformDiagnostics(grantId: string | undefined, userId: string, platformRole: string) {
    if (!grantId) throw new AppError("Support grant ID is required", 403, ErrorCodes.FORBIDDEN);

    const grant = await prisma.supportAccessGrant.findFirst({
      where: { id: grantId, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { supportMembership: { select: { userId: true } } },
    });
    if (!grant) throw new AppError("Valid support access grant not found", 403, ErrorCodes.FORBIDDEN);

    const isSuperAdmin = platformRole === "SUPER_ADMIN";
    if (!isSuperAdmin && grant.supportMembership.userId !== userId) {
      throw new AppError("Grant is not assigned to your support membership", 403, ErrorCodes.FORBIDDEN);
    }

    const tenantId = grant.tenantId;
    const result: Record<string, unknown> = { grant: { id: grant.id, reason: grant.reason, scopes: grant.scopes, expiresAt: grant.expiresAt } };

    if (grant.scopes.includes("TENANT_DIAGNOSTICS")) {
      const [tenant, activeMembers, mailboxes] = await Promise.all([
        prisma.tenant.findFirst({ where: { id: tenantId }, select: { id: true, name: true, status: true, planCode: true, createdAt: true } }),
        prisma.tenantMembership.count({ where: { tenantId, status: "ACTIVE" } }),
        prisma.mailbox.count({ where: { tenantId } }),
      ]);
      result.tenant = { ...tenant, activeMembers, mailboxes };
    }
    if (grant.scopes.includes("DNS_DIAGNOSTICS")) {
      result.domains = await prisma.mailDomain.findMany({
        where: { tenantId },
        select: { id: true, domainName: true, verificationStatus: true, mxStatus: true, spfStatus: true, dkimStatus: true, dmarcStatus: true, lastCheckedAt: true },
      });
    }
    if (grant.scopes.includes("DELIVERY_DIAGNOSTICS")) {
      result.delivery = await prisma.deliveryEvent.groupBy({
        by: ["type"],
        where: { tenantId, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
        _count: true,
      });
    }
    if (grant.scopes.includes("AUDIT_READ")) {
      result.audit = await prisma.auditEvent.findMany({
        where: { tenantId },
        select: { id: true, eventType: true, targetType: true, targetId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    }

    await auditService.record({
      tenantId,
      actorUserId: userId,
      eventType: "SUPPORT_DIAGNOSTICS_ACCESSED",
      actorType: "SUPPORT",
      targetType: "SupportAccessGrant",
      targetId: grant.id,
      metadata: { scopes: grant.scopes, source: "support-console" },
    });

    return result;
  }
  /**
   * The workspace's configuration, read-only — RBAC §2 "View tenant
   * configuration", Support = grant.
   *
   * The console could already show what a workspace *has* — counts of
   * mailboxes, domains, jobs. It could not show how the workspace is *set
   * up*, which is the half most support questions actually turn on: why is
   * this member locked out, why did the assistant skip this mailbox, why is
   * sending from this domain refused. Answering those meant asking the
   * customer to read their own settings screen back over a call.
   *
   * Configuration only. Nothing here is a secret, and `safeJson` is what
   * keeps it that way even if somebody later parks a token in
   * `tenant.settings` — that column is free-form JSON, so the safe
   * assumption is that one day it will hold something it should not.
   */
  async tenantConfiguration(tenantId: string) {
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId },
      select: {
        id: true, name: true, status: true, planCode: true, timezone: true,
        language: true, allowedDomains: true, memberLimit: true,
        passwordPolicy: true, aiSettings: true, settings: true,
        createdAt: true, updatedAt: true,
      },
    });
    if (!tenant) throw new AppError("Tenant not found", 404, ErrorCodes.NOT_FOUND);

    const [policies, domains, aiRestricted, mailboxes, sendingSuspended] = await Promise.all([
      prisma.tenantPolicy.findMany({
        where: { tenantId, status: "ACTIVE" },
        select: {
          id: true, type: true, name: true, description: true, version: true,
          status: true, rules: true, activatedAt: true, updatedAt: true,
        },
        orderBy: { type: "asc" },
      }),
      prisma.mailDomain.findMany({
        where: { tenantId },
        select: { id: true, domainName: true, verificationStatus: true, sendingEnabled: true, activatedAt: true },
        orderBy: { domainName: "asc" },
      }),
      // AC-008's restricted set as a count rather than a list: how many
      // mailboxes the assistant is kept out of is configuration; which ones
      // they are is a member-level detail this view has no reason to name.
      prisma.mailbox.count({ where: { tenantId, aiEnabled: false } }),
      prisma.mailbox.count({ where: { tenantId } }),
      prisma.mailbox.count({ where: { tenantId, sendSuspendedAt: { not: null } } }),
    ]);

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        status: tenant.status,
        planCode: tenant.planCode,
        timezone: tenant.timezone,
        language: tenant.language,
        memberLimit: tenant.memberLimit,
        allowedDomains: tenant.allowedDomains,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      },
      passwordPolicy: safeJson(tenant.passwordPolicy),
      aiSettings: safeJson(tenant.aiSettings),
      settings: safeJson(tenant.settings),
      policies: policies.map((policy) => ({ ...policy, rules: safeJson(policy.rules) })),
      domains,
      mail: { mailboxes, aiRestrictedMailboxes: aiRestricted, sendingSuspendedMailboxes: sendingSuspended },
    };
  }

  /**
   * What is in a member's mailbox — RBAC §2 "Read private user mailbox".
   *
   * The one capability in the matrix that reaches private content, and the
   * only role holding it is Support, as a grant. Two conditions beyond an
   * ordinary console read, both enforced here rather than at the route
   * because both depend on the grant rather than on the caller:
   *
   *  - the live grant must carry MAIL_CONTENT, so approving a delivery
   *    investigation does not quietly become approving a mail read;
   *  - every call is written to the tenant's audit log naming the mailbox,
   *    because §7 requires the customer to be able to see afterwards exactly
   *    what support looked at.
   *
   * Headers only. §7 asks support views to "prefer metadata, status, error
   * codes, hashes, and excerpts over full content", and the questions this
   * exists for — did it arrive, who sent it, what happened to it — are
   * answered without the body. Bodies are not returned by this endpoint at
   * all. That is a deliberate stopping point rather than an unfinished one,
   * and moving it belongs to whoever owns the security spec.
   */
  async mailboxMessages(input: {
    tenantId: string;
    mailboxId: string;
    actorUserId: string;
    // Typed as the enum rather than a bare string, so the `where` below
    // needs no cast and a folder the schema does not allow cannot reach it.
    folder?: MailFolder;
    q?: string;
    limit?: number;
  }) {
    const { tenantId, mailboxId, actorUserId } = input;
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);

    const grant = await prisma.supportAccessGrant.findFirst({
      where: {
        tenantId,
        supportMembership: { userId: actorUserId },
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { expiresAt: "desc" },
      select: { id: true, scopes: true, expiresAt: true, reason: true, ticketId: true },
    });

    if (!grant || !grant.scopes.includes("MAIL_CONTENT")) {
      // Recorded even though nothing was read. A refused attempt to open
      // someone's mailbox is exactly the thing a customer reviewing the log
      // afterwards would want to know about.
      await auditService.record({
        tenantId, actorUserId, actorType: "SUPPORT",
        eventType: "SUPPORT_ACCESS_DENIED",
        targetType: "Mailbox", targetId: mailboxId,
        metadata: {
          capability: "mail.other.read",
          requiredScope: "MAIL_CONTENT",
          heldScopes: grant?.scopes ?? [],
        },
      });
      throw new AppError(
        "Reading a mailbox needs a support access grant that covers mail content. Ask the workspace owner to approve one.",
        403,
        ErrorCodes.FORBIDDEN
      );
    }

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, tenantId },
      select: {
        id: true, address: true, type: true, aiEnabled: true,
        sendSuspendedAt: true, sendSuspensionReason: true,
        membership: { select: { id: true, user: { select: { email: true, displayName: true } } } },
      },
    });
    if (!mailbox) throw new AppError("Mailbox not found", 404, ErrorCodes.NOT_FOUND);

    const rows = await prisma.mailboxMessage.findMany({
      where: {
        tenantId,
        mailboxId,
        ...(input.folder ? { folder: input.folder } : {}),
        ...(input.q
          ? {
              message: {
                OR: [
                  { subject: { contains: input.q, mode: "insensitive" as const } },
                  { fromAddress: { contains: input.q, mode: "insensitive" as const } },
                ],
              },
            }
          : {}),
      },
      select: {
        id: true, folder: true, isRead: true, createdAt: true,
        message: {
          select: {
            id: true, subject: true, fromAddress: true,
            status: true, sentAt: true, createdAt: true,
            // Recipients are their own rows rather than an array column, and
            // TO is the one this view needs — CC and BCC would turn a triage
            // list into a wall, and BCC in particular is not support's to
            // put on a screen.
            recipients: { where: { type: "TO" }, select: { email: true } },
            _count: { select: { attachments: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // A restricted mailbox stays restricted even here. The grant says
    // support may read this mailbox; AC-008 says its owner has turned
    // processing off, and subject is the field the data model marks
    // redactable for exactly that case. The remaining metadata is what
    // triage runs on and is returned either way.
    const restricted = mailbox.aiEnabled
      ? new Set<string>()
      : new Set(rows.map((row) => row.message.id));

    await auditService.record({
      tenantId, actorUserId, actorType: "SUPPORT",
      eventType: "SUPPORT_MAILBOX_READ",
      targetType: "Mailbox", targetId: mailbox.id,
      metadata: redactMetadata({
        mailbox: mailbox.address,
        grantId: grant.id,
        ticketId: grant.ticketId,
        reason: grant.reason,
        messagesReturned: rows.length,
        folder: input.folder ?? null,
        query: input.q ?? null,
        subjectsRedacted: restricted.size > 0,
      }) as Prisma.InputJsonValue,
    });

    return {
      mailbox: {
        id: mailbox.id,
        address: mailbox.address,
        type: mailbox.type,
        aiEnabled: mailbox.aiEnabled,
        sendSuspendedAt: mailbox.sendSuspendedAt,
        sendSuspensionReason: mailbox.sendSuspensionReason,
        owner: mailbox.membership?.user ?? null,
      },
      grant: { id: grant.id, expiresAt: grant.expiresAt },
      messages: rows.map((row) => ({
        id: row.id,
        folder: row.folder,
        isRead: row.isRead,
        // A received message has no sentAt of its own, so the row's own
        // createdAt — when it landed in this mailbox — is the timestamp a
        // support agent is actually asking about.
        receivedAt: row.message.sentAt ?? row.createdAt,
        subject: redactSubject(row.message.subject, row.message.id, restricted),
        from: row.message.fromAddress,
        to: row.message.recipients.map((recipient) => recipient.email),
        status: row.message.status,
        attachments: row.message._count.attachments,
      })),
    };
  }
}

/**
 * A free-form JSON column, with anything that looks like a credential taken
 * out before it reaches a console outside the tenant.
 *
 * `tenant.settings`, `aiSettings` and a policy's `rules` are open-shaped, so
 * what they hold is whatever some later feature decides to put there.
 * Support needs to read configuration out of them; nobody needs support to
 * read a key. Matched by key name rather than by value, because a redactor
 * that guesses at contents will miss the first thing it has not seen before.
 */
function safeJson(value: Prisma.JsonValue | null | undefined): Prisma.JsonValue | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => safeJson(item)) as Prisma.JsonValue;
  if (typeof value !== "object") return value;

  const out: Record<string, Prisma.JsonValue> = {};
  for (const [key, val] of Object.entries(value as Record<string, Prisma.JsonValue>)) {
    out[key] = SECRETISH_KEY.test(key) ? "[redacted]" : (safeJson(val) as Prisma.JsonValue);
  }
  return out;
}

const SECRETISH_KEY =
  /(secret|token|password|passwd|credential|apikey|api_key|private|signature|salt|hash)/i;

function jobResource(payload: Prisma.JsonValue | null | undefined): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  for (const key of ["address", "mailbox", "mailboxAddress", "email", "accountId", "userId", "recipient", "messageId", "fileName"]) {
    const value = p[key];
    if (typeof value === "string" && value.length > 0) return value.slice(0, 120);
  }
  return null;
}

export const supportService = new SupportService();
