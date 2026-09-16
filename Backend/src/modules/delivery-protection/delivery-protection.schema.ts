import { z } from "zod";

export const createSuppressionSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  reason: z.literal("ADMIN").default("ADMIN"),
});
export const suppressionIdSchema = z.object({ suppressionId: z.string().uuid() });
export const warmupMailboxSchema = z.object({ mailboxId: z.string().uuid() });
export const setWarmupCapSchema = z.object({ cap: z.number().int().min(1).max(1000).nullable() });

