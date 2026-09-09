import { z } from "zod";

/**
 * Same bounds as the standalone delivery-failure endpoint, so the tile reads
 * the same number whichever route the client used to get it.
 */
export const dashboardQuerySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(168).default(24),
});
