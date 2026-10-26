import type { Prisma, WorkSubjectType, WorkVisibility } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { sseManager } from "../../common/sse/sse.manager.js";
import { auditService } from "../audit/audit.service.js";
import { assertTimeZone } from "../calendar/calendar.span.js";
import type { EvidenceInput } from "./workgraph.schema.js";

/**
 * What every Work Graph service shares: who the caller is, who may see and
 * change an item, how an owner is named, and how a source (a message or a
 * meeting) is attached without leaking it to anyone who could not open it.
 */
export interface WorkContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  /** The member's real role. A workspace Owner or Admin approves decisions nobody was named for. */
  membershipRole?: string;
  requestId?: string;
}

export const notFound = (what = "Item") => new AppError(`${what} not found`, 404, ErrorCodes.NOT_FOUND);
export const forbidden = (message: string, reason: string) => new AppError(message, 403, ErrorCodes.FORBIDDEN, { reason });

/** What a record shows for somebody whose membership was erased: the record stays, the person does not. */
export const FORMER_MEMBER = { name: "Former member", email: "", isMe: false } as const;

export const isWorkspaceAdmin = (context: WorkContext) => context.membershipRole === "OWNER" || context.membershipRole === "ADMIN";

export function nameOf(user: { displayName: string | null; email: string }): string {
  return user.displayName?.trim() || user.email;
}

export function checkZone(zone: string | undefined): string {
  if (!zone) return "UTC";
  assertTimeZone(zone);
  return zone;
}

/**
 * What the caller may see: items shared with the workspace, and anything they
 * created, own or (for a decision) were named to approve. Nobody else's —
 * a private item answers 404, as if it did not exist.
 */
export function visibleWhere(context: WorkContext, extra: Array<Record<string, unknown>> = []) {
  return {
    tenantId: context.tenantId,
    OR: [
      { visibility: "WORKSPACE" as WorkVisibility },
      { createdByMembershipId: context.membershipId },
      { ownerMembershipId: context.membershipId },
      ...extra,
    ],
  };
}

export const memberSelect = { id: true, userId: true, user: { select: { email: true, displayName: true } } } satisfies Prisma.TenantMembershipSelect;
type MemberRow = Prisma.TenantMembershipGetPayload<{ select: typeof memberSelect }>;

/** An active member of this workspace, by sign-in or mailbox address. */
export async function memberByEmail(email: string, context: WorkContext): Promise<MemberRow> {
  const address = email.trim().toLowerCase();
  const member = await prisma.tenantMembership.findFirst({
    where: {
      tenantId: context.tenantId,
      status: "ACTIVE",
      OR: [{ user: { email: { equals: address, mode: "insensitive" } } }, { mailbox: { address: { equals: address, mode: "insensitive" } } }],
    },
    select: memberSelect,
  });
  if (!member) throw new AppError(`${email} is not a member of this workspace.`, 404, ErrorCodes.NOT_FOUND, { reason: "NOT_A_MEMBER" });
  return member;
}

/**
 * The accountable owner from what was entered: a colleague's address, or a
 * named team. Neither given means the caller, when `defaultToSelf`.
 */
export async function resolveOwner(
  input: { ownerEmail?: string; ownerLabel?: string | null },
  context: WorkContext,
  defaultToSelf = true
): Promise<{ ownerMembershipId: string | null; ownerLabel: string | null; member: MemberRow | null }> {
  if (input.ownerEmail) {
    const member = await memberByEmail(input.ownerEmail, context);
    return { ownerMembershipId: member.id, ownerLabel: null, member };
  }
  const named = input.ownerLabel?.trim();
  if (named) return { ownerMembershipId: null, ownerLabel: named, member: null };
  if (defaultToSelf) return { ownerMembershipId: context.membershipId, ownerLabel: null, member: null };
  return { ownerMembershipId: null, ownerLabel: null, member: null };
}

export interface OwnerView {
  kind: "MEMBER" | "TEAM" | "NONE";
  name: string;
  email: string | null;
  isMe: boolean;
}

export function ownerView(
  owner: { id: string; user: { email: string; displayName: string | null } } | null | undefined,
  ownerLabel: string | null,
  context: WorkContext
): OwnerView {
  if (owner) return { kind: "MEMBER", name: nameOf(owner.user), email: owner.user.email, isMe: owner.id === context.membershipId };
  if (ownerLabel) return { kind: "TEAM", name: ownerLabel, email: null, isMe: false };
  return { kind: "NONE", name: "Unassigned", email: null, isMe: false };
}

/** A workstream the caller can see, or 404. */
export async function requireStream(streamId: string, context: WorkContext) {
  const stream = await prisma.workStream.findFirst({ where: { id: streamId, ...visibleWhere(context) }, select: { id: true, title: true, visibility: true, status: true } });
  if (!stream) throw notFound("Workstream");
  if (stream.status === "ARCHIVED") {
    throw new AppError("That workstream is archived. Reopen it to add to it.", 409, ErrorCodes.CONFLICT, { reason: "STREAM_ARCHIVED" });
  }
  return stream;
}

export const audit = (context: WorkContext, eventType: string, targetType: string, targetId: string, metadata: Prisma.InputJsonValue = {}) =>
  auditService.record({ tenantId: context.tenantId, actorUserId: context.userId, eventType, targetType, targetId, requestId: context.requestId, metadata });

/**
 * A notification in the bell, and a live nudge so an open page refreshes.
 * Sent after the change is committed; a failure is logged, never undoes it.
 */
export async function notifyWork(
  context: WorkContext,
  recipients: Array<{ userId: string | null | undefined }>,
  message: { type?: "INFO" | "ACTION_REQUIRED"; title: string; body: string; linkPath: string }
): Promise<void> {
  const userIds = Array.from(new Set(recipients.map((r) => r.userId).filter((id): id is string => Boolean(id) && id !== context.userId)));
  if (userIds.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        tenantId: context.tenantId,
        userId,
        type: message.type ?? "INFO",
        title: message.title,
        body: message.body,
        linkPath: message.linkPath,
      })),
    });
    for (const userId of userIds) {
      sseManager.sendToUser(userId, {
        type: "NOTIFICATION",
        tenantId: context.tenantId,
        userId,
        payload: { title: message.title, body: message.body, kind: "workgraph" },
      });
    }
  } catch (error) {
    logger.warn({ err: error }, "Could not send a Work Graph notification");
  }
}

// ── Evidence ────────────────────────────────────────────────────────────────

export interface EvidenceView {
  id: string;
  kind: "EMAIL" | "MEETING" | "DOCUMENT" | "NOTE";
  label: string;
  occurredAt: Date | null;
  refId: string | null;
  /** False when the viewer cannot open the source; its name is then withheld. */
  canOpen: boolean;
  openPath: string | null;
  addedByMe: boolean;
}

const KIND_WORD = { EMAIL: "email", MEETING: "meeting", DOCUMENT: "document", NOTE: "note" } as const;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The messages the caller can open (their own mailbox), with the folder each is in. */
export async function openableMessages(ids: string[], context: WorkContext) {
  if (ids.length === 0) return new Map<string, { folder: string; subject: string; at: Date }>();
  const rows = await prisma.mailboxMessage.findMany({
    where: { tenantId: context.tenantId, messageId: { in: ids }, mailbox: { membershipId: context.membershipId } },
    select: { messageId: true, folder: true, createdAt: true, message: { select: { subject: true } } },
  });
  return new Map(rows.map((r) => [r.messageId, { folder: r.folder as string, subject: r.message.subject, at: r.createdAt }]));
}

/** The meetings the caller can open: ones they organise or are invited to. */
async function openableMeetings(ids: string[], context: WorkContext) {
  if (ids.length === 0) return new Map<string, { title: string; startsAt: Date }>();
  const rows = await prisma.calendarEvent.findMany({
    where: {
      tenantId: context.tenantId,
      id: { in: ids },
      OR: [{ organizerMembershipId: context.membershipId }, { attendees: { some: { membershipId: context.membershipId } } }],
    },
    select: { id: true, title: true, startsAt: true },
  });
  return new Map(rows.map((r) => [r.id, { title: r.title, startsAt: r.startsAt }]));
}

/**
 * Attach sources to something, inside the caller's transaction. A message or
 * a meeting must be one the caller can open, and it is named by the source,
 * not by whatever the client sent — so nobody can attach (or spoof) a source
 * they cannot read.
 */
export async function attachEvidence(
  tx: Prisma.TransactionClient,
  subjectType: WorkSubjectType,
  subjectId: string,
  items: EvidenceInput[],
  context: WorkContext
) {
  if (items.length === 0) return [];
  const messages = await openableMessages(items.filter((i) => i.kind === "EMAIL").map((i) => i.refId!), context);
  const meetings = await openableMeetings(items.filter((i) => i.kind === "MEETING").map((i) => i.refId!), context);
  const created = [];
  const seen = new Set<string>();
  for (const item of items) {
    let label = item.label?.trim() ?? "";
    let occurredAt: Date | null = item.occurredAt ?? null;
    if (item.kind === "EMAIL") {
      const found = messages.get(item.refId!);
      if (!found) throw new AppError("You can only link a message from your own mailbox.", 404, ErrorCodes.NOT_FOUND, { reason: "SOURCE_NOT_OPENABLE" });
      label = found.subject || "(no subject)";
      occurredAt = found.at;
    } else if (item.kind === "MEETING") {
      const found = meetings.get(item.refId!);
      if (!found) throw new AppError("You can only link a meeting you organise or are invited to.", 404, ErrorCodes.NOT_FOUND, { reason: "SOURCE_NOT_OPENABLE" });
      label = found.title;
      occurredAt = found.startsAt;
    }
    const key = `${item.kind}:${item.refId ?? label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // The same message or meeting is attached to a thing once.
    if (item.refId) {
      const existing = await tx.workEvidence.findFirst({ where: { tenantId: context.tenantId, subjectType, subjectId, kind: item.kind, refId: item.refId } });
      if (existing) continue;
    }
    created.push(
      await tx.workEvidence.create({
        data: {
          tenantId: context.tenantId,
          subjectType,
          subjectId,
          kind: item.kind,
          refId: item.refId ?? null,
          label,
          occurredAt,
          addedByMembershipId: context.membershipId,
        },
      })
    );
  }
  return created;
}

/** The sources of each subject, as the caller may see them. */
export async function evidenceViews(subjectType: WorkSubjectType, subjectIds: string[], context: WorkContext): Promise<Map<string, EvidenceView[]>> {
  const out = new Map<string, EvidenceView[]>();
  if (subjectIds.length === 0) return out;
  const rows = await prisma.workEvidence.findMany({
    where: { tenantId: context.tenantId, subjectType, subjectId: { in: subjectIds } },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
  });
  const messages = await openableMessages(rows.filter((r) => r.kind === "EMAIL").map((r) => r.refId!), context);
  const meetings = await openableMeetings(rows.filter((r) => r.kind === "MEETING").map((r) => r.refId!), context);
  for (const r of rows) {
    const mine = r.addedByMembershipId === context.membershipId;
    let canOpen = true;
    let openPath: string | null = null;
    if (r.kind === "EMAIL") {
      const found = messages.get(r.refId!);
      canOpen = Boolean(found);
      openPath = found ? `/mail?open=${r.refId}&folder=${found.folder}` : null;
    } else if (r.kind === "MEETING") {
      const found = meetings.get(r.refId!);
      canOpen = Boolean(found);
      openPath = found ? `/mail/calendar?date=${isoDay(found.startsAt)}` : null;
    }
    const list = out.get(r.subjectId) ?? [];
    list.push({
      id: r.id,
      kind: r.kind,
      // A source the viewer cannot open is not named to them, unless they attached it.
      label: canOpen || mine ? r.label : `Restricted ${KIND_WORD[r.kind]}`,
      occurredAt: r.occurredAt,
      refId: canOpen || mine ? r.refId : null,
      canOpen,
      openPath,
      addedByMe: mine,
    });
    out.set(r.subjectId, list);
  }
  return out;
}

export async function deleteEvidenceFor(tx: Prisma.TransactionClient, subjectType: WorkSubjectType, subjectId: string, context: WorkContext) {
  await tx.workEvidence.deleteMany({ where: { tenantId: context.tenantId, subjectType, subjectId } });
}
