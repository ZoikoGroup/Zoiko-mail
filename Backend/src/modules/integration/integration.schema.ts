import { z } from "zod";
export const createIntegrationSchema = z.object({
  product: z.enum(["ZOIKO_ONE", "SEMA", "VERTEX", "LOCAL", "TIME", "NEX"]),
  resourceType: z.enum(["TASK", "MEETING", "WORKFLOW", "LINK"]),
  sourceType: z.enum(["MESSAGE", "THREAD", "COMMITMENT"]),
  sourceId: z.string().uuid(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export const integrationLinkIdSchema = z.object({ linkId: z.string().uuid() });
export const updateIntegrationSchema = z.object({
  externalRef: z.string().trim().max(500).nullable().optional(),
  status: z.enum(["PENDING", "LINKED", "FAILED", "REMOVED"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
