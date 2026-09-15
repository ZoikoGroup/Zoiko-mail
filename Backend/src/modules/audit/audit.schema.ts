import { z } from "zod";

export const auditEventParamsSchema = z.object({
  eventId: z.string().uuid(),
});

export const auditEventQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    eventType: z.string().trim().min(1).max(100).optional(),
    /**
     * Event-type prefixes, OR-ed together.
     *
     * A category on the screen is rarely one event type — "Identity" is
     * LOGIN_, MFA_, PASSWORD_ and SESSION_ — so an exact eventType cannot
     * express it and the screen would be back to filtering a page in the
     * browser. Repeat the parameter to pass several.
     */
    eventTypePrefix: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : (Array.isArray(value) ? value : [value])
      )
      .pipe(z.array(z.string().trim().min(1).max(100)).max(20).optional()),
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

/**
 * The same filters as `list`, without page or limit.
 *
 * An export that paginated would be the defect it exists to fix: the screen
 * already shows a page, and the reason to export is to get everything the
 * filter matches. Bounded by the filters the caller chose, not by a window.
 */
export const auditExportQuerySchema = z
  .object({
    eventType: z.string().trim().min(1).max(100).optional(),
    /**
     * Event-type prefixes, OR-ed together.
     *
     * A category on the screen is rarely one event type — "Identity" is
     * LOGIN_, MFA_, PASSWORD_ and SESSION_ — so an exact eventType cannot
     * express it and the screen would be back to filtering a page in the
     * browser. Repeat the parameter to pass several.
     */
    eventTypePrefix: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : (Array.isArray(value) ? value : [value])
      )
      .pipe(z.array(z.string().trim().min(1).max(100)).max(20).optional()),
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

export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;

