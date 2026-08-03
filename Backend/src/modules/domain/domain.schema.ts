import { z } from "zod";
export const domainIdSchema = z.object({ domainId: z.string().uuid() });
export const addDomainSchema = z.object({
  domainName: z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]+\.)+[a-z]{2,63}$/),
});
