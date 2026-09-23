import { z } from "zod";
export const domainIdSchema = z.object({ domainId: z.string().uuid() });
export const addDomainSchema = z.object({
  domainName: z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]+\.)+[a-z]{2,63}$/),
});

/** Cursor pagination — API §4. Shared so every list answers the same way. */
export { paginationQuerySchema as listQuerySchema } from "../../common/utils/pagination.js";
