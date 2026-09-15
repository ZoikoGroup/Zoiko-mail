import { Prisma } from "@prisma/client";
import type { ParticipantType, ThreadParticipantRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";

/**
 * Participants — Data Model §6.7, §6.8; API §12.
 *
 * "Normalizes a person or email identity inside a tenant so commitments can
 * be owed by and owed to stable entities across messages and threads."
 *
 * Before this, a participant was a string in a JSON array on the thread.
 * Three things followed from that and all three are the point of this
 * module: you could not ask what else an address had been involved in, a
 * commitment could only be owned by an internal user — so an obligation owed
 * *to* a customer had nowhere to point — and §12's rule that "commitments
 * must never expose opaque participant IDs without a resolution path" could
 * not be met, because there was nothing to resolve.
 *
 * The thread keeps its JSON array, and it is derived here rather than
 * maintained separately. Two lists of the same thing that are written in two
 * places diverge; this one is a projection of the rows below.
 */

/** Addresses nobody is behind. §6.7 gives them their own type. */
const SYSTEM_LOCAL_PARTS = new Set([
  "no-reply",
  "noreply",
  "do-not-reply",
  "donotreply",
  "mailer-daemon",
  "postmaster",
  "bounces",
]);

export interface ParticipantSummary {
  participantId: string;
  displayName: string | null;
  primaryEmail: string;
  participantType: ParticipantType;
}

/** The shape §12 shows for an inline participant. */
export const participantSummarySelect = {
  id: true,
  canonicalEmail: true,
  displayName: true,
  participantType: true,
} satisfies Prisma.ParticipantSelect;

type SummaryRow = Prisma.ParticipantGetPayload<{ select: typeof participantSummarySelect }>;

export function toParticipantSummary(row: SummaryRow): ParticipantSummary {
  return {
    participantId: row.id,
    displayName: row.displayName,
    primaryEmail: row.canonicalEmail,
    participantType: row.participantType,
  };
}

interface ObservedAddress {
  email: string;
  displayName?: string | null;
  role: ThreadParticipantRole;
}

export interface ThreadParticipation {
  tenantId: string;
  threadId: string;
  messageId: string;
  addresses: ObservedAddress[];
}

type Client = Prisma.TransactionClient | typeof prisma;

export class ParticipantService {
  /**
   * Find or create the participant for an address.
   *
   * Not `upsert`, because the uniqueness §6.7 asks for is partial — one
   * *active* participant per address — and Prisma can only upsert against a
   * unique constraint it knows about. The read-then-write is racy by nature,
   * so a lost race is caught and resolved by reading again: the partial
   * index is what actually guarantees there is only one.
   */
  async resolve(
    tenantId: string,
    email: string,
    displayName: string | null | undefined,
    client: Client = prisma
  ) {
    const canonicalEmail = email.trim().toLowerCase();
    if (!canonicalEmail) {
      throw new AppError("An address is required", 422, ErrorCodes.VALIDATION_ERROR);
    }

    const existing = await client.participant.findFirst({
      where: { tenantId, canonicalEmail, status: "ACTIVE" },
      select: { id: true, displayName: true, participantType: true },
    });

    if (existing) {
      // A name only ever improves: a later message carrying one fills in an
      // address first seen bare, and a later message carrying none does not
      // erase it.
      const shouldName = Boolean(displayName) && !existing.displayName;
      await client.participant.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          ...(shouldName ? { displayName } : {}),
        },
      });
      return { id: existing.id, canonicalEmail };
    }

    const classified = await this.classify(tenantId, canonicalEmail, client);
    try {
      const created = await client.participant.create({
        data: {
          tenantId,
          canonicalEmail,
          displayName: displayName ?? classified.displayName ?? null,
          participantType: classified.participantType,
          linkedUserId: classified.linkedUserId,
        },
        select: { id: true },
      });
      return { id: created.id, canonicalEmail };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // Someone else created it between the read and the write. The index
        // did its job; read the winner.
        const winner = await client.participant.findFirstOrThrow({
          where: { tenantId, canonicalEmail, status: "ACTIVE" },
          select: { id: true },
        });
        return { id: winner.id, canonicalEmail };
      }
      throw error;
    }
  }

  /**
   * What kind of address this is, and whether it belongs to a member.
   *
   * Worth getting right at creation: it is what lets a client tell a
   * colleague from a customer from a distribution list without inspecting
   * the address itself.
   */
  private async classify(
    tenantId: string,
    canonicalEmail: string,
    client: Client
  ): Promise<{
    participantType: ParticipantType;
    linkedUserId: string | null;
    displayName: string | null;
  }> {
    const membership = await client.tenantMembership.findFirst({
      where: {
        tenantId,
        status: "ACTIVE",
        user: { email: { equals: canonicalEmail, mode: "insensitive" } },
      },
      select: { userId: true, user: { select: { displayName: true } } },
    });
    if (membership) {
      return {
        participantType: "INTERNAL_USER",
        linkedUserId: membership.userId,
        displayName: membership.user.displayName,
      };
    }

    const localPart = canonicalEmail.split("@")[0] ?? "";
    if (SYSTEM_LOCAL_PARTS.has(localPart)) {
      return { participantType: "SYSTEM", linkedUserId: null, displayName: null };
    }

    // A shared mailbox, distribution address or alias is a group rather than
    // a person, and a commitment owed "to sales@" means something different
    // from one owed to a named colleague.
    const [groupMailbox, alias] = await Promise.all([
      client.mailbox.findFirst({
        where: { tenantId, address: canonicalEmail, type: { in: ["SHARED", "DISTRIBUTION"] } },
        select: { id: true },
      }),
      client.alias.findFirst({
        where: { tenantId, address: canonicalEmail },
        select: { id: true },
      }),
    ]);
    if (groupMailbox || alias) {
      return { participantType: "GROUP_ADDRESS", linkedUserId: null, displayName: null };
    }

    return { participantType: "EXTERNAL_PERSON", linkedUserId: null, displayName: null };
  }

  /**
   * Record who took part in a thread, and how.
   *
   * Roles accumulate: somebody who sent the first message and was copied on
   * the third is both, and a timeline that dropped the first would
   * misattribute the conversation. Returns the canonical addresses so the
   * caller can store the thread's denormalised list from the same pass.
   */
  async recordThreadParticipation(
    input: ThreadParticipation,
    client: Client = prisma
  ): Promise<string[]> {
    const byEmail = new Map<string, ObservedAddress[]>();
    for (const address of input.addresses) {
      const key = address.email.trim().toLowerCase();
      if (!key) continue;
      byEmail.set(key, [...(byEmail.get(key) ?? []), address]);
    }

    const canonical: string[] = [];
    for (const [email, observations] of byEmail) {
      const participant = await this.resolve(
        input.tenantId,
        email,
        observations.find((observation) => observation.displayName)?.displayName,
        client
      );
      canonical.push(participant.canonicalEmail);

      const roles = [...new Set(observations.map((observation) => observation.role))];
      const link = await client.threadParticipant.findUnique({
        where: {
          tenantId_threadId_participantId: {
            tenantId: input.tenantId,
            threadId: input.threadId,
            participantId: participant.id,
          },
        },
        select: { id: true, roles: true },
      });

      if (link) {
        await client.threadParticipant.update({
          where: { id: link.id },
          data: {
            roles: [...new Set([...link.roles, ...roles])],
            lastMessageId: input.messageId,
          },
        });
      } else {
        await client.threadParticipant.create({
          data: {
            tenantId: input.tenantId,
            threadId: input.threadId,
            participantId: participant.id,
            roles,
            firstMessageId: input.messageId,
            lastMessageId: input.messageId,
          },
        });
      }
    }

    return canonical;
  }

  /**
   * One participant, following a merge to whichever row survived.
   *
   * A merged id stays resolvable on purpose: it may be sitting in a client's
   * cache or in an old commitment, and answering "no such participant" would
   * make a successful deduplication look like data loss.
   */
  async get(tenantId: string, participantId: string) {
    const found = await prisma.participant.findFirst({
      where: { id: participantId, tenantId },
    });
    if (!found) throw new AppError("Participant not found", 404, ErrorCodes.NOT_FOUND);
    let current: typeof found = found;

    const seen = new Set<string>([current.id]);
    while (current.status === "MERGED" && current.mergeParentId) {
      if (seen.has(current.mergeParentId)) break; // a cycle; stop rather than spin
      const next = await prisma.participant.findFirst({
        where: { id: current.mergeParentId, tenantId },
      });
      if (!next) break;
      seen.add(next.id);
      current = next;
    }

    const [threadCount, openCommitments] = await Promise.all([
      prisma.threadParticipant.count({
        where: { tenantId, participantId: current.id },
      }),
      prisma.commitment.count({
        where: {
          tenantId,
          status: "OPEN",
          OR: [{ owedByParticipantId: current.id }, { owedToParticipantId: current.id }],
        },
      }),
    ]);

    return {
      participantId: current.id,
      displayName: current.displayName,
      primaryEmail: current.canonicalEmail,
      // §12's example calls this out as a list. One address per participant
      // today; the field is plural because merging two rows is what makes it
      // several, and clients should not have to change shape when it does.
      emailAddresses: [current.canonicalEmail],
      participantType: current.participantType,
      organizationName: current.organizationName,
      linkedUserId: current.linkedUserId,
      status: current.status,
      firstSeenAt: current.firstSeenAt,
      lastSeenAt: current.lastSeenAt,
      threadCount,
      openCommitmentCount: openCommitments,
      tenantId: current.tenantId,
      ...(current.id === participantId ? {} : { resolvedFromMergedId: participantId }),
    };
  }

  /** §12: "List participants visible in tenant context. Supports search by email/name." */
  async list(
    tenantId: string,
    filters: { q?: string; type?: ParticipantType; page: number; limit: number }
  ) {
    const where: Prisma.ParticipantWhereInput = {
      tenantId,
      // Merged and deleted rows are history, not directory entries.
      status: "ACTIVE",
      ...(filters.type ? { participantType: filters.type } : {}),
      ...(filters.q
        ? {
            OR: [
              { canonicalEmail: { contains: filters.q, mode: "insensitive" } },
              { displayName: { contains: filters.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.participant.findMany({
        where,
        select: {
          ...participantSummarySelect,
          organizationName: true,
          lastSeenAt: true,
          linkedUserId: true,
          _count: { select: { threadLinks: true } },
        },
        orderBy: { lastSeenAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.participant.count({ where }),
    ]);

    return {
      participants: rows.map((row) => ({
        ...toParticipantSummary(row),
        organizationName: row.organizationName,
        linkedUserId: row.linkedUserId,
        lastSeenAt: row.lastSeenAt,
        threadCount: row._count.threadLinks,
      })),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  /** §12: "List participants in a thread." */
  async listForThread(tenantId: string, threadId: string) {
    const thread = await prisma.messageThread.findFirst({
      where: { id: threadId, tenantId },
      select: { id: true },
    });
    if (!thread) throw new AppError("Thread not found", 404, ErrorCodes.NOT_FOUND);

    const links = await prisma.threadParticipant.findMany({
      where: { tenantId, threadId },
      select: {
        roles: true,
        firstMessageId: true,
        lastMessageId: true,
        participant: { select: participantSummarySelect },
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      participants: links.map((link) => ({
        ...toParticipantSummary(link.participant),
        roles: link.roles,
        firstMessageId: link.firstMessageId,
        lastMessageId: link.lastMessageId,
      })),
    };
  }

  /**
   * §12: "List threads associated with participant. Metadata only."
   *
   * Metadata only is load-bearing, not a style note: this is a read keyed by
   * *somebody else's* address, so returning bodies here would be a way to
   * read mail by asking about the person instead of the message (AC-011).
   */
  async listThreads(
    tenantId: string,
    participantId: string,
    filters: { page: number; limit: number }
  ) {
    const participant = await this.get(tenantId, participantId);
    const where: Prisma.ThreadParticipantWhereInput = {
      tenantId,
      participantId: participant.participantId,
    };

    const [links, total] = await prisma.$transaction([
      prisma.threadParticipant.findMany({
        where,
        select: {
          roles: true,
          thread: {
            select: {
              id: true,
              subjectNormalized: true,
              messageCount: true,
              firstMessageAt: true,
              lastMessageAt: true,
              _count: { select: { participantLinks: true } },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.threadParticipant.count({ where }),
    ]);

    return {
      threads: links.map((link) => ({
        threadId: link.thread.id,
        subject: link.thread.subjectNormalized,
        messageCount: link.thread.messageCount,
        participantCount: link.thread._count.participantLinks,
        firstMessageAt: link.thread.firstMessageAt,
        lastMessageAt: link.thread.lastMessageAt,
        roles: link.roles,
      })),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  /** §12: "List commitments owed by/to participant." */
  async listCommitments(
    tenantId: string,
    participantId: string,
    filters: { page: number; limit: number }
  ) {
    const participant = await this.get(tenantId, participantId);
    const where: Prisma.CommitmentWhereInput = {
      tenantId,
      OR: [
        { owedByParticipantId: participant.participantId },
        { owedToParticipantId: participant.participantId },
      ],
    };

    const [commitments, total] = await prisma.$transaction([
      prisma.commitment.findMany({
        where,
        select: {
          id: true,
          text: true,
          status: true,
          priority: true,
          dueAt: true,
          threadId: true,
          createdAt: true,
          // Inlined rather than referenced by id, which is the whole point of
          // §12: "commitments must never expose opaque participant IDs
          // without a resolution path".
          owedBy: { select: participantSummarySelect },
          owedTo: { select: participantSummarySelect },
        },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.commitment.count({ where }),
    ]);

    return {
      commitments: commitments.map((commitment) => ({
        ...commitment,
        owedBy: commitment.owedBy ? toParticipantSummary(commitment.owedBy) : null,
        owedTo: commitment.owedTo ? toParticipantSummary(commitment.owedTo) : null,
      })),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }
}

export const participantService = new ParticipantService();
