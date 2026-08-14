import { z } from "zod";
export const grantIdSchema = z.object({ grantId: z.string().uuid() });
export const createGrantSchema = z.object({
  supportMembershipId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
  expiresInMinutes: z.number().int().min(5).max(240),
  scopes: z.array(z.enum(["TENANT_DIAGNOSTICS", "DNS_DIAGNOSTICS", "DELIVERY_DIAGNOSTICS", "AUDIT_READ"])).min(1),
});

export const tenantParamSchema = z.object({ tenantId: z.string().uuid() });
export const domainParamSchema = z.object({ tenantId: z.string().uuid(), domainId: z.string().uuid() });
export const mailboxParamSchema = z.object({ tenantId: z.string().uuid(), mailboxId: z.string().uuid() });

export const platformListQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  provider: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
