import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";

type Create = {
  name: string;
  address: string;
  kind: Prisma.MailGroupCreateInput["kind"];
};
type Update = {
  name?: string;
  kind?: Prisma.MailGroupCreateInput["kind"];
  status?: Prisma.MailGroupCreateInput["status"];
};

export class GroupService {
  list(tenantId: string) {
    return prisma.mailGroup.findMany({
      where: { tenantId },
      include: { _count: { select: { members: true } } },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });
  }

  async get(tenantId: string, groupId: string) {
    const group = await prisma.mailGroup.findFirst({
      where: { id: groupId, tenantId },
      include: {
        members: {
          include: { membership: { include: { user: { select: { id: true, email: true, displayName: true } } } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!group) throw new AppError("Group not found", 404, ErrorCodes.NOT_FOUND);
    return group;
  }

  async create(input: Create, tenantId: string, userId: string) {
    const group = await prisma.mailGroup.create({
      data: { tenantId, ...input },
    });
    await auditService.record({
      tenantId, actorUserId: userId, eventType: "GROUP_CREATED",
      targetType: "MailGroup", targetId: group.id,
      metadata: { name: group.name, address: group.address, kind: group.kind },
    });
    return group;
  }

  async update(tenantId: string, groupId: string, input: Update, userId: string) {
    await this.get(tenantId, groupId);
    const group = await prisma.mailGroup.update({ where: { id: groupId, tenantId }, data: input });
    await auditService.record({
      tenantId, actorUserId: userId, eventType: "GROUP_UPDATED",
      targetType: "MailGroup", targetId: groupId,
      metadata: { changedFields: Object.keys(input) },
    });
    return group;
  }

  async remove(tenantId: string, groupId: string, userId: string) {
    await this.get(tenantId, groupId);
    const removed = await prisma.mailGroup.delete({ where: { id: groupId, tenantId } });
    await auditService.record({
      tenantId, actorUserId: userId, eventType: "GROUP_DELETED",
      targetType: "MailGroup", targetId: groupId,
      metadata: { name: removed.name, address: removed.address },
    });
    return removed;
  }

  listMembers(tenantId: string, groupId: string) {
    return prisma.mailGroupMember.findMany({
      where: { groupId, group: { tenantId } },
      include: { membership: { include: { user: { select: { id: true, email: true, displayName: true } } } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async addMember(tenantId: string, groupId: string, membershipId: string, userId: string) {
    await this.get(tenantId, groupId);
    const membership = await prisma.tenantMembership.findFirst({ where: { id: membershipId, tenantId, status: "ACTIVE" }, select: { id: true } });
    if (!membership) throw new AppError("Active membership not found", 404, ErrorCodes.NOT_FOUND);
    const member = await prisma.mailGroupMember.upsert({
      where: { groupId_membershipId: { groupId, membershipId } },
      create: { groupId, membershipId },
      update: {},
    });
    await auditService.record({
      tenantId, actorUserId: userId, eventType: "GROUP_MEMBER_ADDED",
      targetType: "MailGroup", targetId: groupId, metadata: { membershipId },
    });
    return member;
  }

  async removeMember(tenantId: string, groupId: string, membershipId: string, userId: string) {
    await this.get(tenantId, groupId);
    const existing = await prisma.mailGroupMember.findUnique({
      where: { groupId_membershipId: { groupId, membershipId } },
    });
    if (!existing) throw new AppError("Group member not found", 404, ErrorCodes.NOT_FOUND);
    const removed = await prisma.mailGroupMember.delete({ where: { groupId_membershipId: { groupId, membershipId } } });
    await auditService.record({
      tenantId, actorUserId: userId, eventType: "GROUP_MEMBER_REMOVED",
      targetType: "MailGroup", targetId: groupId, metadata: { membershipId },
    });
    return removed;
  }
}
export const groupService = new GroupService();