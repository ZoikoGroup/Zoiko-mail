import type { PlatformRole, Prisma, SupportScope } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService, redactMetadata } from "../audit/audit.service.js";

const DELIVERY_ISSUE_TYPES = ["FAILED", "BOUNCED", "REJECTED", "BLOCKED"] as const;

export class SupportService {
  async overview(tenantId: string) {
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
        select: { id: true, type: true, failureCode: true, failureReason: true, createdAt: true, message: { select: { subject: true, fromAddress: true, fromName: true } } },
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

    const issues = [
      ...failedMessages.map((msg) => ({
        id: `MSG-${msg.id.slice(0, 8)}`,
        kind: "message" as const,
        subject: msg.subject || "(no subject)",
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
        subject: ev.message?.subject || "Delivery event",
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
      members,
      team,
      issues,
      audit: audit.map((event) => ({
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
  async create(input: { supportMembershipId: string; reason: string; expiresInMinutes: number; scopes: SupportScope[] }, tenantId: string, userId: string) {
    const membership = await prisma.tenantMembership.findFirst({ where: { id: input.supportMembershipId, tenantId, role: "SUPPORT", status: "ACTIVE" } });
    if (!membership) throw new AppError("Active SUPPORT membership not found", 404, ErrorCodes.NOT_FOUND);
    await prisma.supportAccessGrant.updateMany({ where: { tenantId, supportMembershipId: membership.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
    const grant = await prisma.supportAccessGrant.create({ data: { tenantId, supportMembershipId: membership.id, approvedByUserId: userId, reason: input.reason, scopes: input.scopes, expiresAt: new Date(Date.now() + input.expiresInMinutes * 60_000) } });
    await auditService.record({ tenantId, actorUserId: userId, eventType: "SUPPORT_ACCESS_GRANTED", targetType: "SupportAccessGrant", targetId: grant.id, metadata: { scopes: grant.scopes, expiresAt: grant.expiresAt.toISOString(), reason: grant.reason } });
    return grant;
  }
  async revoke(id: string, tenantId: string, userId: string) {
    const grant = await prisma.supportAccessGrant.findFirst({ where: { id, tenantId, revokedAt: null } });
    if (!grant) throw new AppError("Active support grant not found", 404, ErrorCodes.NOT_FOUND);
    const updated = await prisma.supportAccessGrant.update({ where: { id: grant.id, tenantId }, data: { revokedAt: new Date() } });
    await auditService.record({ tenantId, actorUserId: userId, eventType: "SUPPORT_ACCESS_REVOKED", targetType: "SupportAccessGrant", targetId: id });
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
    await auditService.record({ tenantId, actorUserId: userId, eventType: "SUPPORT_DIAGNOSTICS_ACCESSED", targetType: "SupportAccessGrant", targetId: grant.id, metadata: { scopes: grant.scopes } });
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

    const [activeTenants, tenantMembers, activeMailboxes, configuredDomains, failedSends24h, failedJobs, retryJobs, syncFailures24h] =
      await Promise.all([
        prisma.tenant.count({ where: { status: "ACTIVE" } }),
        prisma.tenantMembership.count({ where: { status: { in: ["ACTIVE", "INVITED"] } } }),
        prisma.mailbox.count(),
        prisma.mailDomain.count(),
        prisma.emailMessage.count({ where: { status: "FAILED", updatedAt: { gte: since24h } } }),
        prisma.backgroundJob.count({ where: { status: "FAILED" } }),
        prisma.backgroundJob.count({ where: { status: "RETRY" } }),
        prisma.providerEvent.count({ where: { processingStatus: { in: ["FAILED", "DEAD_LETTER"] }, receivedAt: { gte: since24h } } }),
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
          select: { id: true, type: true, failureCode: true, failureReason: true, providerEventId: true, createdAt: true, tenantId: true, message: { select: { subject: true, fromAddress: true, fromName: true, tenant: { select: { id: true, name: true } } } } },
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

    const issues = [
      ...failedMessages.map((m) => ({
        id: m.id, kind: "message" as const,
        tenantId: m.tenant.id, tenantName: m.tenant.name,
        resourceType: this.issueRows.message,
        resource: m.fromAddress ?? m.subject ?? m.id.slice(0, 8),
        status: "FAILED", error: m.scheduleLastError ?? null, providerEventId: null, createdAt: m.updatedAt,
      })),
      ...failedDeliveries.map((e) => ({
        id: e.id, kind: "delivery" as const,
        tenantId: e.tenantId, tenantName: e.message?.tenant?.name ?? "Unknown",
        resourceType: this.issueRows.delivery,
        resource: `${e.message?.fromAddress ?? "unknown"} · ${e.message?.subject ?? "delivery event"}`,
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
    }));
  }

  async searchMailboxes(query: string, limit = 50) {
    const q = query.trim();
    const where: Prisma.MailboxWhereInput = q
      ? {
          OR: [
            { address: { contains: q, mode: "insensitive" } },
            { tenant: { name: { contains: q, mode: "insensitive" } } },
            { membership: { user: { email: { contains: q, mode: "insensitive" } } } },
          ],
        }
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
      memberName: m.membership.user.displayName,
      memberEmail: m.membership.user.email,
      suspended: m.sendSuspendedAt !== null,
      suspensionReason: m.sendSuspensionReason,
      createdAt: m.createdAt,
      connectedAccounts: m.membership.connectedAccounts,
    }));
  }

  async searchDomains(query: string, limit = 50) {
    const q = query.trim();
    const where: Prisma.MailDomainWhereInput = q
      ? {
          OR: [
            { domainName: { contains: q, mode: "insensitive" } },
            { tenant: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
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
      prisma.providerEvent.findMany({
        where: { tenantId, connectedAccount: { membershipId: mailbox.membershipId } },
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
        member: mailbox.membership.user,
        connectedAccounts: mailbox.membership.connectedAccounts,
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
            subject: e.message.subject,
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
      targetType: "SupportAccessGrant",
      targetId: grant.id,
      metadata: { scopes: grant.scopes, source: "support-console" },
    });

    return result;
  }
}

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
