import { z } from "zod";
export const grantIdSchema = z.object({ grantId: z.string().uuid() });
export const createGrantSchema = z.object({
  supportMembershipId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
  expiresInMinutes: z.number().int().min(5).max(240),
  scopes: z.array(z.enum(["TENANT_DIAGNOSTICS", "DNS_DIAGNOSTICS", "DELIVERY_DIAGNOSTICS", "AUDIT_READ"])).min(1),
});
