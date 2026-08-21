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
export const updateSendingStatusSchema = z.object({
  suspended: z.boolean(),
  reason: z.string().trim().min(3).max(500).optional(),
}).superRefine((value, context) => {
  if (value.suspended && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Reason is required when suspending sending" });
  }
});
export const listMailSchema = z.object({
  folder: z.enum(["DRAFTS", "INBOX", "ARCHIVE", "SENT", "TRASH", "QUARANTINE"]).default("INBOX"),
  starredOnly: z.coerce.boolean().default(false),
  unreadOnly: z.coerce.boolean().default(false),
  labelId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
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
