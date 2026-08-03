import { z } from "zod";
export const aiIdSchema = z.object({ aiActionId: z.string().uuid() });
export const createAiActionSchema = z.object({
  actionType: z.enum(["DRAFT", "SUMMARY", "COMMITMENT_EXTRACTION", "REPLY_OWED", "DEADLINE", "APPROVAL"]),
  messageId: z.string().uuid().optional(),
  threadId: z.string().uuid().optional(),
}).refine((v) => Boolean(v.messageId || v.threadId), "A messageId or threadId is required");
export const completeAiActionSchema = z.object({
  output: z.record(z.string(), z.unknown()),
  confidenceScore: z.number().min(0).max(1),
  sourceExcerpt: z.string().trim().min(1).max(2000),
});
export const reviewAiActionSchema = z.object({ status: z.enum(["CONFIRMED", "DISMISSED"]) });
