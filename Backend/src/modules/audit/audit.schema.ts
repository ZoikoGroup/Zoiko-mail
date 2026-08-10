import { z } from "zod";

export const auditEventParamsSchema = z.object({
  eventId: z.string().uuid(),
});

export const auditEventQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    eventType: z.string().trim().min(1).max(100).optional(),
    actorUserId: z.string().uuid().optional(),
    targetType: z.string().trim().min(1).max(100).optional(),
    targetId: z.string().trim().min(1).max(255).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to),
    { message: "from must be earlier than or equal to to", path: ["from"] }
  );

export type AuditEventQuery = z.infer<typeof auditEventQuerySchema>;
