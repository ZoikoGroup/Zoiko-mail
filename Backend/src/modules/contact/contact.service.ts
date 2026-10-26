import { prisma } from "../../config/prisma.js";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import {
  createContactSchema,
  type CreateContactInput,
  type UpdateContactInput,
  type ListContactsInput,
  type ImportContactsInput,
  type MergeContactsInput,
} from "./contact.schema.js";

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
  membershipId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  company: true,
  jobTitle: true,
  notes: true,
  tags: true,
  avatarUrl: true,
  isFavorite: true,
  visibility: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  membership: { select: { user: { select: { displayName: true, email: true } } } },
} satisfies Prisma.ContactSelect;

type ContactRow = Prisma.ContactGetPayload<{ select: typeof contactSelect }>;

/** Addresses nobody is behind; never offered as Other Contacts. */
const SYSTEM_LOCAL_PARTS = new Set([
  "no-reply", "noreply", "do-not-reply", "donotreply", "mailer-daemon", "postmaster", "bounces",
]);

/** Folders whose correspondents count as people one deals with. */
const CORRESPONDENCE_FOLDERS = ["INBOX", "SENT", "ARCHIVE"] as const;

function notFound(): AppError {
  return new AppError("Contact not found", 404, ErrorCodes.NOT_FOUND);
}

function nameOf(user: { displayName: string | null; email: string }): string {
  return user.displayName?.trim() || user.email;
}

/**
 * What a caller is shown. A shared contact is readable by the workspace but
 * stays its owner's: `owned` says whether this caller may change it, and the
 * star is the owner's own, so it is not shown to anyone else.
 */
function present(row: ContactRow, context: ContactContext) {
  const { membership, membershipId, ...contact } = row;
  const owned = membershipId === context.membershipId;
  return {
    ...contact,
    isFavorite: owned ? contact.isFavorite : false,
    owned,
    ownerName: owned ? null : nameOf(membership.user),
  };
}

export class ContactService {
  /** Mine, plus what others in the workspace share. */
  private visible(context: ContactContext): Prisma.ContactWhereInput {
    return {
      tenantId: context.tenantId,
      OR: [
        { membershipId: context.membershipId },
        { visibility: "SHARED", membership: { status: "ACTIVE" } },
      ],
    };
  }

  private scopeWhere(scope: ListContactsInput["scope"], context: ContactContext): Prisma.ContactWhereInput {
    switch (scope) {
      case "all":
        return this.visible(context);
      case "shared":
        return { tenantId: context.tenantId, visibility: "SHARED", membership: { status: "ACTIVE" } };
      case "personal":
        return { tenantId: context.tenantId, membershipId: context.membershipId, visibility: "PERSONAL" };
      case "favorites":
        return { tenantId: context.tenantId, membershipId: context.membershipId, isFavorite: true };
      case "mine":
      default:
        return { tenantId: context.tenantId, membershipId: context.membershipId };
    }
  }

  /** The caller's own addresses: sign-in email and personal mailbox. */
  private async ownAddresses(context: ContactContext): Promise<Set<string>> {
    const membership = await prisma.tenantMembership.findUnique({
      where: { id: context.membershipId },
      select: { user: { select: { email: true } }, mailbox: { select: { address: true } } },
    });
    const own = new Set<string>();
    if (membership?.user.email) own.add(membership.user.email.toLowerCase());
    if (membership?.mailbox?.address) own.add(membership.mailbox.address.toLowerCase());
    return own;
  }

  /** The caller's personal mailbox, or null if they have never had one. */
  private async ownMailboxId(context: ContactContext): Promise<string | null> {
    const mailbox = await prisma.mailbox.findFirst({
      where: { tenantId: context.tenantId, membershipId: context.membershipId },
      select: { id: true },
    });
    return mailbox?.id ?? null;
  }

  async list(filters: ListContactsInput, context: ContactContext) {
    const where: Prisma.ContactWhereInput = {
      AND: [
        this.scopeWhere(filters.scope, context),
        filters.q
          ? {
              OR: [
                { firstName: { contains: filters.q, mode: "insensitive" } },
                { lastName: { contains: filters.q, mode: "insensitive" } },
                { email: { contains: filters.q, mode: "insensitive" } },
                { company: { contains: filters.q, mode: "insensitive" } },
                { jobTitle: { contains: filters.q, mode: "insensitive" } },
                { phone: { contains: filters.q, mode: "insensitive" } },
              ],
            }
          : {},
        filters.tag ? { tags: { has: filters.tag } } : {},
      ],
    };

    const byName: Prisma.ContactOrderByWithRelationInput[] = [
      { firstName: { sort: "asc", nulls: "last" } },
      { lastName: { sort: "asc", nulls: "last" } },
      { email: "asc" },
    ];
    const orderBy =
      filters.sort === "recent"
        ? [{ updatedAt: "desc" as const }, { email: "asc" as const }]
        : filters.sort === "company"
          ? [{ company: { sort: "asc" as const, nulls: "last" as const } }, ...byName]
          : byName;

    const [rows, total] = await Promise.all([
      contactModel.findMany({
        where,
        select: contactSelect,
        orderBy,
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      contactModel.count({ where }),
    ]);

    return {
      items: rows.map((row) => present(row, context)),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  /** The counts beside each list in the Contacts sidebar, and the groups (tags). */
  async summary(context: ContactContext) {
    const [all, mine, personal, shared, favorites, directory, tagged] = await Promise.all([
      contactModel.count({ where: this.scopeWhere("all", context) }),
      contactModel.count({ where: this.scopeWhere("mine", context) }),
      contactModel.count({ where: this.scopeWhere("personal", context) }),
      contactModel.count({ where: this.scopeWhere("shared", context) }),
      contactModel.count({ where: this.scopeWhere("favorites", context) }),
      prisma.tenantMembership.count({
        where: { tenantId: context.tenantId, status: "ACTIVE", id: { not: context.membershipId } },
      }),
      contactModel.findMany({ where: this.visible(context), select: { tags: true } }),
    ]);
    const groups = new Map<string, number>();
    for (const row of tagged) for (const tag of row.tags) groups.set(tag, (groups.get(tag) ?? 0) + 1);
    return {
      all,
      mine,
      personal,
      shared,
      favorites,
      directory,
      groups: Array.from(groups, ([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async getById(contactId: string, context: ContactContext) {
    const contact = await contactModel.findFirst({
      where: { AND: [{ id: contactId }, this.visible(context)] },
      select: contactSelect,
    });
    if (!contact) throw notFound();
    return present(contact, context);
  }

  /** A contact this caller may change: their own. A shared one they can only read. */
  private async ownedOrRefuse(contactId: string, context: ContactContext) {
    const contact = await contactModel.findFirst({
      where: { AND: [{ id: contactId }, this.visible(context)] },
    });
    if (!contact) throw notFound();
    if (contact.membershipId !== context.membershipId) {
      throw new AppError(
        "This contact is shared by someone else. Only they can change or delete it.",
        403,
        ErrorCodes.FORBIDDEN
      );
    }
    return contact;
  }

  private async assertEmailFree(email: string, context: ContactContext, exceptId?: string) {
    const existing = await contactModel.findUnique({
      where: {
        tenantId_membershipId_email: { tenantId: context.tenantId, membershipId: context.membershipId, email },
      },
      select: { id: true },
    });
    if (existing && existing.id !== exceptId) {
      throw new AppError("A contact with this email already exists", 409, ErrorCodes.CONFLICT);
    }
  }

  async create(input: CreateContactInput, context: ContactContext) {
    const email = input.email.toLowerCase();
    await this.assertEmailFree(email, context);

    const contact = await contactModel.create({
      data: {
        tenantId: context.tenantId,
        membershipId: context.membershipId,
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        phone: input.phone,
        company: input.company,
        jobTitle: input.jobTitle,
        notes: input.notes,
        tags: input.tags ?? [],
        avatarUrl: input.avatarUrl,
        isFavorite: input.isFavorite ?? false,
        visibility: input.visibility ?? "PERSONAL",
        source: input.source ?? "MANUAL",
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
      metadata: { email, visibility: contact.visibility },
    });

    return present(contact, context);
  }

  async update(contactId: string, input: UpdateContactInput, context: ContactContext) {
    const contact = await this.ownedOrRefuse(contactId, context);
    const email = input.email?.toLowerCase();
    if (email && email !== contact.email) await this.assertEmailFree(email, context, contactId);

    const updated = await contactModel.update({
      where: { id: contactId },
      data: {
        ...input,
        ...(email ? { email } : {}),
        // An emptied field is cleared.
        ...Object.fromEntries(
          (["firstName", "lastName", "phone", "company", "jobTitle", "notes"] as const)
            .filter((key) => input[key] === "")
            .map((key) => [key, null])
        ),
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

    return present(updated, context);
  }

  async delete(contactId: string, context: ContactContext) {
    const contact = await this.ownedOrRefuse(contactId, context);

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

  /**
   * Add many contacts at once (Import). Each row is checked on its own: the
   * good ones are saved and every other row comes back with its reason, so
   * one typo does not throw away the file.
   */
  async importContacts(input: ImportContactsInput, context: ContactContext) {
    const skipped: Array<{ row: number; email: string; reason: string }> = [];
    const accepted: Array<Prisma.ContactCreateManyInput> = [];
    const seen = new Set<string>();

    const existing = new Set(
      (
        await contactModel.findMany({
          where: { tenantId: context.tenantId, membershipId: context.membershipId },
          select: { email: true },
        })
      ).map((c) => c.email)
    );

    input.contacts.forEach((raw, index) => {
      const row = index + 1;
      const parsed = createContactSchema.safeParse({
        ...raw,
        email: raw.email?.trim(),
        tags: (raw.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 20),
      });
      if (!parsed.success) {
        skipped.push({ row, email: raw.email ?? "", reason: parsed.error.issues[0]?.message ?? "Invalid row" });
        return;
      }
      const email = parsed.data.email.toLowerCase();
      if (existing.has(email)) {
        skipped.push({ row, email, reason: "Already in your contacts" });
        return;
      }
      if (seen.has(email)) {
        skipped.push({ row, email, reason: "Repeated in this file" });
        return;
      }
      seen.add(email);
      accepted.push({
        tenantId: context.tenantId,
        membershipId: context.membershipId,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        email,
        phone: parsed.data.phone,
        company: parsed.data.company,
        jobTitle: parsed.data.jobTitle,
        notes: parsed.data.notes,
        tags: parsed.data.tags,
        source: "IMPORT",
      });
    });

    const created = accepted.length
      ? (await contactModel.createMany({ data: accepted, skipDuplicates: true })).count
      : 0;

    if (created > 0) {
      await auditService.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        eventType: "CONTACTS_IMPORTED",
        targetType: "Contact",
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { created, skipped: skipped.length },
      });
    }

    return { created, skipped };
  }

  /**
   * People in this workspace: name and the address mail reaches them at.
   * The same facts the calendar's attendee picker already shows any member;
   * nothing about their mail, calendar or contacts.
   */
  async directory(q: string, context: ContactContext) {
    const term = q.trim();
    const members = await prisma.tenantMembership.findMany({
      where: {
        tenantId: context.tenantId,
        status: "ACTIVE",
        id: { not: context.membershipId },
        ...(term
          ? {
              OR: [
                { user: { email: { contains: term, mode: "insensitive" } } },
                { user: { displayName: { contains: term, mode: "insensitive" } } },
                { mailbox: { address: { contains: term, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        user: { select: { email: true, displayName: true, avatarUrl: true } },
        mailbox: { select: { address: true } },
      },
      orderBy: { user: { displayName: "asc" } },
      take: 500,
    });

    const emails = members.map((m) => (m.mailbox?.address ?? m.user.email).toLowerCase());
    const saved = new Map(
      (
        await contactModel.findMany({
          where: { tenantId: context.tenantId, membershipId: context.membershipId, email: { in: emails } },
          select: { id: true, email: true },
        })
      ).map((c) => [c.email, c.id])
    );

    return members.map((m, i) => ({
      membershipId: m.id,
      name: nameOf(m.user),
      email: emails[i]!,
      avatarUrl: m.user.avatarUrl,
      savedContactId: saved.get(emails[i]!) ?? null,
    }));
  }

  /**
   * People the caller has corresponded with, from their own mailbox only,
   * who are neither saved contacts nor members of the workspace.
   */
  async otherContacts(q: string, context: ContactContext) {
    const mailboxId = await this.ownMailboxId(context);
    if (!mailboxId) return [];
    const [own, saved, members] = await Promise.all([
      this.ownAddresses(context),
      contactModel.findMany({
        where: { tenantId: context.tenantId, membershipId: context.membershipId },
        select: { email: true },
      }),
      prisma.tenantMembership.findMany({
        where: { tenantId: context.tenantId, status: "ACTIVE" },
        select: { user: { select: { email: true } }, mailbox: { select: { address: true } } },
      }),
    ]);
    const known = new Set<string>([
      ...own,
      ...saved.map((c) => c.email),
      ...members.flatMap((m) => [m.user.email.toLowerCase(), m.mailbox?.address?.toLowerCase()].filter(Boolean) as string[]),
    ]);

    const placements = await prisma.mailboxMessage.findMany({
      where: { tenantId: context.tenantId, mailboxId, folder: { in: [...CORRESPONDENCE_FOLDERS] } },
      select: {
        createdAt: true,
        message: {
          select: { fromAddress: true, fromName: true, sentAt: true, recipients: { select: { email: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    const people = new Map<string, { email: string; name: string | null; messageCount: number; lastAt: Date }>();
    const note = (address: string | null | undefined, name: string | null, at: Date) => {
      const email = address?.trim().toLowerCase();
      if (!email || !email.includes("@") || known.has(email)) return;
      if (SYSTEM_LOCAL_PARTS.has(email.split("@")[0]!)) return;
      const entry = people.get(email);
      if (entry) {
        entry.messageCount += 1;
        if (!entry.name && name) entry.name = name;
        if (at > entry.lastAt) entry.lastAt = at;
      } else {
        people.set(email, { email, name, messageCount: 1, lastAt: at });
      }
    };
    for (const placement of placements) {
      const at = placement.message.sentAt ?? placement.createdAt;
      note(placement.message.fromAddress, placement.message.fromName?.trim() || null, at);
      for (const recipient of placement.message.recipients) note(recipient.email, null, at);
    }

    const term = q.trim().toLowerCase();
    return Array.from(people.values())
      .filter((p) => !term || p.email.includes(term) || p.name?.toLowerCase().includes(term))
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
      .slice(0, 200);
  }

  /**
   * The latest mail and meetings between the caller and one address, from the
   * caller's own mailbox and calendar. Nobody else's correspondence is read.
   */
  async activity(email: string, context: ContactContext) {
    const mailboxId = await this.ownMailboxId(context);
    const [messages, events] = await Promise.all([
      mailboxId
        ? prisma.mailboxMessage.findMany({
            where: {
              tenantId: context.tenantId,
              mailboxId,
              folder: { notIn: ["DRAFTS", "SPAM", "QUARANTINE"] },
              message: {
                OR: [
                  { fromAddress: { equals: email, mode: "insensitive" } },
                  { recipients: { some: { email: { equals: email, mode: "insensitive" } } } },
                ],
              },
            },
            select: {
              messageId: true,
              folder: true,
              createdAt: true,
              message: { select: { subject: true, sentAt: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          })
        : Promise.resolve([]),
      prisma.calendarEvent.findMany({
        where: {
          tenantId: context.tenantId,
          AND: [
            {
              OR: [
                { organizerMembershipId: context.membershipId },
                { attendees: { some: { membershipId: context.membershipId } } },
              ],
            },
            {
              OR: [
                { attendees: { some: { email: { equals: email, mode: "insensitive" } } } },
                { organizer: { user: { email: { equals: email, mode: "insensitive" } } } },
                { organizer: { mailbox: { address: { equals: email, mode: "insensitive" } } } },
              ],
            },
          ],
        },
        select: { id: true, title: true, startsAt: true, allDay: true },
        orderBy: { startsAt: "desc" },
        take: 5,
      }),
    ]);

    return {
      messages: messages.map((m) => ({
        messageId: m.messageId,
        subject: m.message.subject || "(no subject)",
        folder: m.folder,
        at: (m.message.sentAt ?? m.createdAt).toISOString(),
      })),
      events: events.map((e) => ({
        eventId: e.id,
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        allDay: e.allDay,
      })),
    };
  }

  /**
   * The caller's own contacts that look like the same person: the same full
   * name, or the same phone number. Each email is already unique.
   */
  async duplicates(context: ContactContext) {
    const rows = await contactModel.findMany({
      where: { tenantId: context.tenantId, membershipId: context.membershipId },
      select: contactSelect,
      orderBy: { createdAt: "asc" },
    });
    const groups: Array<{ reason: "NAME" | "PHONE"; key: string; contacts: ReturnType<typeof present>[] }> = [];
    const grouped = new Set<string>();
    const collect = (reason: "NAME" | "PHONE", keyOf: (row: ContactRow) => string | null) => {
      const buckets = new Map<string, ContactRow[]>();
      for (const row of rows) {
        if (grouped.has(row.id)) continue;
        const key = keyOf(row);
        if (!key) continue;
        buckets.set(key, [...(buckets.get(key) ?? []), row]);
      }
      for (const [key, members] of buckets) {
        if (members.length < 2) continue;
        members.forEach((m) => grouped.add(m.id));
        groups.push({ reason, key, contacts: members.map((m) => present(m, context)) });
      }
    };
    collect("NAME", (row) => {
      const name = [row.firstName, row.lastName].filter(Boolean).join(" ").trim().toLowerCase().replace(/\s+/g, " ");
      return name.length >= 2 ? name : null;
    });
    collect("PHONE", (row) => {
      const digits = row.phone?.replace(/\D/g, "") ?? "";
      return digits.length >= 7 ? digits : null;
    });
    return groups;
  }

  /**
   * Fold duplicates into one contact: empty fields are filled from the
   * others, groups are combined, and the others are deleted.
   */
  async merge(input: MergeContactsInput, context: ContactContext) {
    const ids = [input.keepId, ...input.mergeIds];
    const rows = await contactModel.findMany({
      where: { id: { in: ids }, tenantId: context.tenantId, membershipId: context.membershipId },
    });
    if (rows.length !== ids.length) throw notFound();
    const keep = rows.find((r) => r.id === input.keepId)!;
    const others = rows.filter((r) => r.id !== input.keepId);

    const fill = <K extends "firstName" | "lastName" | "phone" | "company" | "jobTitle" | "avatarUrl">(key: K) =>
      keep[key] ?? others.find((o) => o[key])?.[key] ?? null;
    const notes = [keep.notes, ...others.map((o) => o.notes)].filter(Boolean).join("\n\n").slice(0, 2000) || null;

    const merged = await prisma.$transaction(async (tx) => {
      await tx.contact.deleteMany({ where: { id: { in: input.mergeIds } } });
      return tx.contact.update({
        where: { id: keep.id },
        data: {
          firstName: fill("firstName"),
          lastName: fill("lastName"),
          phone: fill("phone"),
          company: fill("company"),
          jobTitle: fill("jobTitle"),
          avatarUrl: fill("avatarUrl"),
          notes,
          tags: Array.from(new Set([...keep.tags, ...others.flatMap((o) => o.tags)])).slice(0, 20),
          isFavorite: keep.isFavorite || others.some((o) => o.isFavorite),
        },
        select: contactSelect,
      });
    });

    await auditService.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      eventType: "CONTACTS_MERGED",
      targetType: "Contact",
      targetId: keep.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { merged: others.map((o) => o.email) },
    });

    return present(merged, context);
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
        AND: [
          this.visible(context),
          {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      take: 8,
      orderBy: { firstName: "asc" },
    });
  }
}

export const contactService = new ContactService();
