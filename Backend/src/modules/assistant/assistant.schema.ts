import { z } from "zod";

export const ASSISTANT_MAX_QUESTION_CHARS = 4000;

export const sendMessageSchema = z
  .object({
    // Absent starts a new conversation.
    conversationId: z.string().uuid().optional(),
    content: z
      .string()
      .trim()
      .max(ASSISTANT_MAX_QUESTION_CHARS, `Keep a question under ${ASSISTANT_MAX_QUESTION_CHARS.toLocaleString("en")} characters`)
      .optional(),
    // Files uploaded first (POST /assistant/attachments), sent with the question.
    attachmentIds: z.array(z.string().uuid()).max(4, "Attach up to 4 files to one question").optional(),
  })
  .refine((v) => Boolean(v.content) || Boolean(v.attachmentIds?.length), {
    message: "Type a question first",
    path: ["content"],
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const renameConversationSchema = z.object({
  title: z.string().trim().min(1, "Give it a name").max(120),
});

export const attachmentIdParamsSchema = z.object({
  attachmentId: z.string().uuid(),
});

export const conversationIdParamsSchema = z.object({
  conversationId: z.string().uuid(),
});
