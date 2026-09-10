import { z } from "zod";

const emailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
const recipientsSchema = z.object({
  to: z.array(emailSchema).min(1).max(100),
  cc: z.array(emailSchema).max(100).default([]),
  bcc: z.array(emailSchema).max(100).default([]),
});

export const createDraftSchema = z.object({
  subject: z.string().trim().max(998).default(""),
  textBody: z.string().max(2_000_000).nullable().optional(),
  htmlBody: z.string().max(2_000_000).nullable().optional(),
  recipients: recipientsSchema,
  /**
   * Send as a shared mailbox instead of your own — Security §10.
   *
   * Absent means your own mailbox, which is what every existing caller gets.
   * Present requires `canSend` on that mailbox; until now that permission was
   * stored and returned but never enforced anywhere, because there was no way
   * to send as a shared mailbox at all.
   */
  sendAsMailboxId: z.string().uuid().optional(),
});

export const updateDraftSchema = createDraftSchema.partial();
export const messageIdParamsSchema = z.object({ messageId: z.string().uuid() });
export const scheduleDraftSchema = z.object({
  scheduledAt: z.coerce.date()
    .refine((value) => value.getTime() >= Date.now() + 60_000, "Schedule time must be at least one minute in the future")
    .refine((value) => value.getTime() <= Date.now() + 366 * 24 * 60 * 60 * 1000, "Schedule time must be within one year"),
});
export const attachmentParamsSchema = z.object({
  messageId: z.string().uuid(),
  attachmentId: z.string().uuid(),
});
export const mailboxIdParamsSchema = z.object({ mailboxId: z.string().uuid() });

/** Reading one message out of a shared mailbox rather than one's own. */
export const mailboxScopeSchema = z.object({ mailboxId: z.string().uuid().optional() });
export const updateSendingStatusSchema = z.object({
  suspended: z.boolean(),
  reason: z.string().trim().min(3).max(500).optional(),
}).superRefine((value, context) => {
  if (value.suspended && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Reason is required when suspending sending" });
  }
});
/**
 * Admin-editable mailbox attributes.
 *
 * Deliberately narrow. `address` is absent because it is the mailbox's
 * identity — renaming it would break routing and the tenant-unique
 * constraint, so a rename is a create-and-migrate, not a patch. The counters
 * (storageUsed, bounceCount, warmupDailyCount, …) are system-maintained; an
 * operator editing them would be falsifying the record the abuse controls read.
 * Sending suspension has its own route because it requires a reason.
 *
 * At least one field must be present, so an empty body is a 400 rather than a
 * silent no-op that reads as success.
 */
export const adminUpdateMailboxSchema = z
  .object({
    // Bytes. Floor is 1 MiB; a zero-quota mailbox would bounce everything.
    storageLimit: z.coerce
      .number()
      .int()
      .min(1_048_576)
      .max(1_099_511_627_776)
      .optional(),
    // Per-day send cap overriding the warm-up ladder. Null clears the override
    // and returns the mailbox to the standard schedule.
    customWarmupCap: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
    // Whether AI may process this mailbox (AC-008). Turning it off is what
    // makes a mailbox "restricted" in the security spec's sense.
    aiEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

/* ── shared mailboxes — Security §10 ─────────────────────────────────── */

export const createSharedMailboxSchema = z.object({
  address: emailSchema,
  // SHARED holds mail the assignees read; DISTRIBUTION only fans out.
  type: z.enum(["SHARED", "DISTRIBUTION"]).default("SHARED"),
});

/**
 * Four separable permissions, per §10. Omitted fields default to read-only
 * rather than to the caller's last values: widening access should be typed
 * out, not inherited.
 */
export const assignMailboxSchema = z.object({
  membershipId: z.string().uuid(),
  canRead: z.boolean().optional(),
  canSend: z.boolean().optional(),
  canManage: z.boolean().optional(),
  canAssign: z.boolean().optional(),
});

export const mailboxAssigneeParamsSchema = z.object({
  mailboxId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

/* ── aliases and forwarding — Data Model §6.17, §6.18 ────────────────── */

export const createAliasSchema = z.object({ address: emailSchema });

export const createForwardingSchema = z.object({
  forwardToAddress: emailSchema,
  // Default true: a rule that silently stops delivering to the mailbox is a
  // surprising default for something an operator sets on someone else's mail.
  keepCopy: z.boolean().default(true),
});

export const aliasParamsSchema = z.object({
  mailboxId: z.string().uuid(),
  aliasId: z.string().uuid(),
});

export const forwardingParamsSchema = z.object({
  mailboxId: z.string().uuid(),
  ruleId: z.string().uuid(),
});

export const listMailSchema = z.object({
  folder: z.enum(["DRAFTS", "INBOX", "ARCHIVE", "SENT", "TRASH", "QUARANTINE"]).default("INBOX"),
  // Absent means the caller's own mailbox, which is what every existing
  // caller gets. Present means a shared mailbox they must hold read on.
  mailboxId: z.string().uuid().optional(),
  starredOnly: z.coerce.boolean().default(false),
  unreadOnly: z.coerce.boolean().default(false),
  labelId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const adminDeliveryEventsQuerySchema = z.object({
  type: z.enum([
    "ACCEPTED", "QUEUED", "DELIVERED", "DEFERRED", "FAILED", "BOUNCED",
    "COMPLAINED", "REJECTED", "BLOCKED", "SUPPRESSED", "RATE_LIMITED", "PROVIDER_ERROR",
  ]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
/**
 * Trailing window for the delivery-failure count.
 *
 * Capped at a week: the dashboard tile asks about recent operational health,
 * and an unbounded window would turn a cheap aggregate into a full-table
 * count as a workspace ages.
 */
export const adminDeliverySummaryQuerySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(168).default(24),
});
export const updateMailboxItemSchema = z.object({
  isRead: z.boolean().optional(),
  isStarred: z.boolean().optional(),
  folder: z.enum(["INBOX", "ARCHIVE", "TRASH"]).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one change is required");

export const bulkMailboxActionSchema = z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(100)
    .transform((ids) => [...new Set(ids)]),
  action: z.enum(["MARK_READ", "MARK_UNREAD", "STAR", "UNSTAR", "ARCHIVE", "TRASH", "RESTORE"]),
});

export const labelIdParamsSchema = z.object({ labelId: z.string().uuid() });
export const messageLabelParamsSchema = z.object({
  messageId: z.string().uuid(),
  labelId: z.string().uuid(),
});
export const createLabelSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((value) => value.toUpperCase()),
});
export const updateLabelSchema = createLabelSchema.partial()
  .refine((value) => Object.keys(value).length > 0, "At least one change is required");

export const replySchema = z.object({
  textBody: z.string().max(2_000_000).nullable().optional(),
  htmlBody: z.string().max(2_000_000).nullable().optional(),
  // Replying as a shared mailbox is the shape the support workflow actually
  // takes: the message being answered sits in the team mailbox, and the answer
  // has to go out from it rather than from whoever happened to pick it up.
  sendAsMailboxId: z.string().uuid().optional(),
});

export const forwardSchema = replySchema.extend({
  recipients: recipientsSchema,
});

export type CreateDraftInput = z.infer<typeof createDraftSchema>;
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;
export type ListMailInput = z.infer<typeof listMailSchema>;
export type UpdateMailboxItemInput = z.infer<typeof updateMailboxItemSchema>;
export type BulkMailboxActionInput = z.infer<typeof bulkMailboxActionSchema>;
export type CreateLabelInput = z.infer<typeof createLabelSchema>;
export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;
