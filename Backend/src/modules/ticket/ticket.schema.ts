import { z } from "zod";

export const TicketCategorySchema = z.enum(["DELIVERY", "DOMAIN", "BILLING", "ACCOUNT", "SECURITY", "OTHER"]);
export const TicketSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const TicketStatusSchema = z.enum(["OPEN", "IN_PROGRESS", "WAITING_TENANT", "RESOLVED", "CLOSED"]);

export const createTenantTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(5000),
  category: TicketCategorySchema.default("OTHER"),
  severity: TicketSeveritySchema.default("MEDIUM"),
});

export const createStaffTicketSchema = createTenantTicketSchema.extend({
  tenantId: z.string().uuid(),
  assignedStaffId: z.string().uuid().nullable().optional(),
});

export const updateTicketSchema = z.object({
  status: TicketStatusSchema.optional(),
  severity: TicketSeveritySchema.optional(),
  assignedStaffId: z.string().uuid().nullable().optional(),
});

export const createTicketCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  internal: z.boolean().optional(),
});

export const ticketIdParamSchema = z.object({ ticketId: z.string().uuid() });

export const ticketListQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: TicketStatusSchema.optional(),
  severity: TicketSeveritySchema.optional(),
  assigned: z.enum(["me", "unassigned", "all"]).optional(),
  overdue: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});