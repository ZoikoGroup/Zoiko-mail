import { prisma } from "../../config/prisma.js";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import type { CreateContactInput, UpdateContactInput, ListContactsInput } from "./contact.schema.js";

const contactModel = prisma.contact;

interface ContactContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const contactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  company: true,
  jobTitle: true,
  notes: true,
  tags: true,
  avatarUrl: true,
  createdAt: true,
  updatedAt: true,
};

export class ContactService {
  async list(filters: ListContactsInput, context: ContactContext) {
    const where: Prisma.ContactWhereInput = {
      tenantId: context.tenantId,
      membershipId: context.membershipId,
      ...(filters.q
        ? {
            OR: [
              { firstName: { contains: filters.q, mode: "insensitive" } },
              { lastName: { contains: filters.q, mode: "insensitive" } },
              { email: { contains: filters.q, mode: "insensitive" } },
              { company: { contains: filters.q, mode: "insensitive" } },
              { phone: { contains: filters.q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(filters.tag ? { tags: { has: filters.tag } } : {}),
    };

    const [items, total] = await Promise.all([
      contactModel.findMany({
        where,
        select: contactSelect,
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { email: "asc" }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      contactModel.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  async getById(contactId: string, context: ContactContext) {
    const contact = await contactModel.findFirst({
      where: { id: contactId, tenantId: context.tenantId, membershipId: context.membershipId },
      select: contactSelect,
    });
    if (!contact) throw new AppError("Contact not found", 404, ErrorCodes.NOT_FOUND);
    return contact;
  }

  async create(input: CreateContactInput, context: ContactContext) {
    // Check for duplicate email within this user's contacts
    const existing = await contactModel.findUnique({
      where: {
        tenantId_membershipId_email: {
          tenantId: context.tenantId,
          membershipId: context.membershipId,
          email: input.email.toLowerCase(),
        },
      },
    });
    if (existing) {
      throw new AppError("A contact with this email already exists", 409, ErrorCodes.CONFLICT);
    }

    const contact = await contactModel.create({
      data: {
        tenantId: context.tenantId,
        membershipId: context.membershipId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email.toLowerCase(),
        phone: input.phone,
        company: input.company,
        jobTitle: input.jobTitle,
        notes: input.notes,
        tags: input.tags ?? [],
        avatarUrl: input.avatarUrl,
      },
      select: contactSelect,
    });

    await auditService.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      eventType: "CONTACT_CREATED",
      targetType: "Contact",
      targetId: contact.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { email: input.email },
    });

    return contact;
  }

  async update(contactId: string, input: UpdateContactInput, context: ContactContext) {
    const contact = await contactModel.findFirst({
      where: { id: contactId, tenantId: context.tenantId, membershipId: context.membershipId },
    });
    if (!contact) throw new AppError("Contact not found", 404, ErrorCodes.NOT_FOUND);

    // If email is being changed, check for duplicates
    if (input.email && input.email.toLowerCase() !== contact.email) {
      const dup = await contactModel.findUnique({
        where: {
          tenantId_membershipId_email: {
            tenantId: context.tenantId,
            membershipId: context.membershipId,
            email: input.email.toLowerCase(),
          },
        },
      });
      if (dup) {
        throw new AppError("A contact with this email already exists", 409, ErrorCodes.CONFLICT);
      }
    }

    const updated = await contactModel.update({
      where: { id: contactId },
      data: {
        ...input,
        ...(input.email ? { email: input.email.toLowerCase() } : {}),
      },
      select: contactSelect,
    });

    await auditService.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      eventType: "CONTACT_UPDATED",
      targetType: "Contact",
      targetId: contactId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { changedFields: Object.keys(input) },
    });

    return updated;
  }

  async delete(contactId: string, context: ContactContext) {
    const contact = await contactModel.findFirst({
      where: { id: contactId, tenantId: context.tenantId, membershipId: context.membershipId },
    });
    if (!contact) throw new AppError("Contact not found", 404, ErrorCodes.NOT_FOUND);

    await contactModel.delete({ where: { id: contactId } });

    await auditService.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      eventType: "CONTACT_DELETED",
      targetType: "Contact",
      targetId: contactId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { email: contact.email },
    });
  }

  /** Returns all unique tags used by this user's contacts */
  async listTags(context: ContactContext): Promise<string[]> {
    const contacts = await contactModel.findMany({
      where: { tenantId: context.tenantId, membershipId: context.membershipId },
      select: { tags: true },
    });
    const tagSet = new Set<string>();
    contacts.forEach((c) => c.tags.forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }

  /** Quick search for compose autocomplete — returns email + name pairs */
  async suggest(q: string, context: ContactContext) {
    if (!q || q.length < 2) return [];
    return contactModel.findMany({
      where: {
        tenantId: context.tenantId,
        membershipId: context.membershipId,
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      take: 8,
      orderBy: { firstName: "asc" },
    });
  }
}

export const contactService = new ContactService();