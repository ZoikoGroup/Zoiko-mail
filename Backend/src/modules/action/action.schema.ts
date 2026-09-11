import { z } from "zod";
export const actionIdSchema = z.object({ actionId: z.string().uuid() });
export const createActionSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  ownerUserId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  threadId: z.string().uuid().optional(),
  dueAt: z.iso.datetime().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  /**
   * Who owes the action and who is waiting for it — §6.10.
   *
   * Addresses rather than participant ids: either side may be somebody
   * outside the workspace, and a client that has just read an email knows
   * the address, not an internal identifier. The server resolves each to a
   * participant, creating one if this is the first time the address has been
   * seen, which is the same path every inbound message takes.
   */
  owedByEmail: z.string().trim().email().max(320).optional(),
  owedToEmail: z.string().trim().email().max(320).optional(),
});
export const updateActionSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "SNOOZED", "COMPLETED", "DISMISSED"]),
  snoozedUntil: z.iso.datetime().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.status === "SNOOZED" && !value.snoozedUntil) ctx.addIssue({ code: "custom", path: ["snoozedUntil"], message: "Required when snoozing" });
});

export const listActionsSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "SNOOZED", "COMPLETED", "DISMISSED"]).optional(),
  since: z.iso.datetime().optional(),      // createdAt >= since
  until: z.iso.datetime().optional(),      // createdAt <= until
  dueBefore: z.iso.datetime().optional(),  // dueAt <= dueBefore  (for overdue / due-today)
  dueAfter: z.iso.datetime().optional(),   // dueAt >= dueAfter   (for upcoming)
});

export type ListActionsInput = z.infer<typeof listActionsSchema>;