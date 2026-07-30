import type { SupportScope } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";

export class SupportService {
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
}
export const supportService = new SupportService();
