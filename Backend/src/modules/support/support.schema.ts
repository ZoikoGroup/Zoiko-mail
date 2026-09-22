import { z } from "zod";

/**
 * The scopes a grant can carry.
 *
 * Written once rather than inline at each use: the two schemas below are a
 * request and its approval, and a scope one of them accepts while the other
 * refuses is a grant that cannot be approved. MAIL_CONTENT was added after
 * the first four and is exactly the kind of addition that drifts apart when
 * the list is duplicated.
 */
const supportScope = z.enum([
  "TENANT_DIAGNOSTICS",
  "DNS_DIAGNOSTICS",
  "DELIVERY_DIAGNOSTICS",
  "AUDIT_READ",
  "MAIL_CONTENT",
]);
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
  scopes: z.array(supportScope).min(1),
});

/**
 * Support asking for access — Runbook §7.
 *
 * Mirrors createGrantSchema rather than reusing it: the request names no
 * membership (it is the caller's own seat) and asks for a window rather than
 * setting one, because the approver may shorten it.
 */
export const requestAccessSchema = z.object({
  reason: z.string().trim().min(10).max(500),
  ticketId: z.string().uuid().optional(),
  scopes: z.array(supportScope).min(1),
  requestedMinutes: z.number().int().min(5).max(240),
});

/** The approver may shorten the window; approveRequest refuses to lengthen it. */
export const approveRequestSchema = z.object({
  minutes: z.number().int().min(5).max(240).optional(),
});

export const denyRequestSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const requestIdSchema = z.object({ requestId: z.string().uuid() });

export const listRequestsSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "DENIED", "WITHDRAWN"]).optional(),
});

export const tenantParamSchema = z.object({ tenantId: z.string().uuid() });
export const domainParamSchema = z.object({ tenantId: z.string().uuid(), domainId: z.string().uuid() });
export const mailboxParamSchema = z.object({ tenantId: z.string().uuid(), mailboxId: z.string().uuid() });
export const jobIdSchema = z.object({ jobId: z.string().uuid() });

export const platformListQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  provider: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Reading inside one mailbox — headers only, and never more than a page. */
export const mailboxMessagesParamsSchema = z.object({ mailboxId: z.string().uuid() });

export const mailboxMessagesQuerySchema = z.object({
  folder: z.enum(["INBOX", "SENT", "DRAFTS", "ARCHIVE", "TRASH", "SPAM"]).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
