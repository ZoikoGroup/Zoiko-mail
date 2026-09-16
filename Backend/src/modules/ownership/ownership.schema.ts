import { z } from "zod";

export const createTransferSchema = z.object({
  targetMembershipId: z.string().uuid(),
});
export const transferIdParamsSchema = z.object({ transferId: z.string().uuid() });