import { z } from "zod";
export const actionIdSchema = z.object({ actionId: z.string().uuid() });
export const createActionSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  ownerUserId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  threadId: z.string().uuid().optional(),
  dueAt: z.iso.datetime().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});
export const updateActionSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "SNOOZED", "COMPLETED", "DISMISSED"]),
  snoozedUntil: z.iso.datetime().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.status === "SNOOZED" && !value.snoozedUntil) ctx.addIssue({ code: "custom", path: ["snoozedUntil"], message: "Required when snoozing" });
});
