import { z } from "zod";
export const grantIdSchema = z.object({ grantId: z.string().uuid() });
/**
 * Opening support access — Runbook §7.
 *
 * `ticketId` carries the purpose the section asks for: "access must be linked
 * to a ticket, incident, or approved customer support request". It is optional
 * in the schema and required by the service unless the reason names an
 * incident, because a P0 can begin before anyone has raised a ticket — what
 * §7 forbids is an access nobody can attribute afterwards, not one opened in a
 * hurry.
 */
export const createGrantSchema = z.object({
  supportMembershipId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
  ticketId: z.string().uuid().optional(),
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
