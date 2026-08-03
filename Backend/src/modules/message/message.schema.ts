import { z } from "zod";

export const messageIdParamsSchema = z.object({ messageId: z.string().uuid() });
export const threadIdParamsSchema = z.object({ threadId: z.string().uuid() });

const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};

export const listMessagesSchema = z.object({
  ...paginationSchema,
  folder: z.enum(["DRAFTS", "INBOX", "ARCHIVE", "SENT", "TRASH"]).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  unreadOnly: z.stringbool().default(false),
});

export const listThreadsSchema = z.object({
  ...paginationSchema,
  q: z.string().trim().min(1).max(200).optional(),
});

export type ListMessagesInput = z.infer<typeof listMessagesSchema>;
export type ListThreadsInput = z.infer<typeof listThreadsSchema>;
