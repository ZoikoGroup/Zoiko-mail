import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import type { ListMessagesInput, ListThreadsInput } from "./message.schema.js";

interface MessageContext {
  tenantId: string;
  userId: string;
  membershipId: string;
}

const messageInclude = {
  author: { select: { id: true, email: true, displayName: true } },
  recipients: { orderBy: [{ type: "asc" as const }, { email: "asc" as const }] },
  attachments: {
    select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
  },
} satisfies Prisma.EmailMessageInclude;

function protectBcc<T extends { authorUserId: string; recipients: Array<{ type: string }> }>(
  message: T,
  userId: string
) {
  return message.authorUserId === userId
    ? message
    : { ...message, recipients: message.recipients.filter((recipient) => recipient.type !== "BCC") };
}

export class MessageService {
  private mailbox(context: MessageContext) {
    return prisma.mailbox.findFirst({
      where: { tenantId: context.tenantId, membershipId: context.membershipId },
      select: { id: true },
    });
  }

  async list(filters: ListMessagesInput, context: MessageContext) {
    const mailbox = await this.mailbox(context);
    if (!mailbox) {
      return {
        messages: [],
        pagination: { page: filters.page, limit: filters.limit, total: 0, totalPages: 0 },
      };
    }
    const search: Prisma.EmailMessageWhereInput | undefined = filters.q
      ? {
          OR: [
            { subject: { contains: filters.q, mode: "insensitive" } },
            { textBody: { contains: filters.q, mode: "insensitive" } },
            { author: { email: { contains: filters.q, mode: "insensitive" } } },
            { recipients: { some: { tenantId: context.tenantId, email: { contains: filters.q, mode: "insensitive" } } } },
          ],
        }
      : undefined;
    const where: Prisma.MailboxMessageWhereInput = {
      tenantId: context.tenantId,
      mailboxId: mailbox.id,
      folder: filters.folder,
      isRead: filters.unreadOnly ? false : undefined,
      message: search,
    };
    const [items, total] = await prisma.$transaction([
      prisma.mailboxMessage.findMany({
        where,
        include: { message: { include: messageInclude } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.mailboxMessage.count({ where }),
    ]);
    return {
      messages: items.map((item) => ({
        mailbox: { folder: item.folder, isRead: item.isRead, receivedAt: item.createdAt },
        ...protectBcc(item.message, context.userId),
      })),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  async get(messageId: string, context: MessageContext) {
    const mailbox = await this.mailbox(context);
    if (!mailbox) throw new AppError("Message not found", 404, ErrorCodes.NOT_FOUND);
    const item = await prisma.mailboxMessage.findFirst({
      where: { tenantId: context.tenantId, mailboxId: mailbox.id, messageId },
      include: {
        message: {
          include: {
            ...messageInclude,
            thread: { select: { id: true, subjectNormalized: true, messageCount: true } },
          },
        },
      },
    });
    if (!item) throw new AppError("Message not found", 404, ErrorCodes.NOT_FOUND);
    return {
      mailbox: { folder: item.folder, isRead: item.isRead, receivedAt: item.createdAt },
      ...protectBcc(item.message, context.userId),
    };
  }

  async listThreads(filters: ListThreadsInput, context: MessageContext) {
    const mailbox = await this.mailbox(context);
    if (!mailbox) {
      return {
        threads: [],
        pagination: { page: filters.page, limit: filters.limit, total: 0, totalPages: 0 },
      };
    }
    const where: Prisma.MessageThreadWhereInput = {
      tenantId: context.tenantId,
      subjectNormalized: filters.q ? { contains: filters.q, mode: "insensitive" } : undefined,
      messages: {
        some: {
          tenantId: context.tenantId,
          mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id } },
        },
      },
    };
    const [threads, total] = await prisma.$transaction([
      prisma.messageThread.findMany({
        where,
        include: {
          messages: {
            where: {
              tenantId: context.tenantId,
              mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id } },
            },
            include: messageInclude,
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.messageThread.count({ where }),
    ]);
    return {
      threads: threads.map((thread) => ({
        ...thread,
        messages: thread.messages.map((message) => protectBcc(message, context.userId)),
      })),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  async getThread(threadId: string, context: MessageContext) {
    const mailbox = await this.mailbox(context);
    if (!mailbox) throw new AppError("Thread not found", 404, ErrorCodes.NOT_FOUND);
    const thread = await prisma.messageThread.findFirst({
      where: {
        id: threadId,
        tenantId: context.tenantId,
        messages: {
          some: {
            tenantId: context.tenantId,
            mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id } },
          },
        },
      },
      include: {
        messages: {
          where: {
            tenantId: context.tenantId,
            mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id } },
          },
          include: messageInclude,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!thread) throw new AppError("Thread not found", 404, ErrorCodes.NOT_FOUND);
    return {
      ...thread,
      messages: thread.messages.map((message) => protectBcc(message, context.userId)),
    };
  }
}

export const messageService = new MessageService();
