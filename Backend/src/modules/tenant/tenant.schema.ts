import { z } from "zod";

const timezone = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "Invalid IANA timezone");

const domain = z.string().trim().toLowerCase().regex(
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
  "Invalid domain"
);

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    timezone: timezone.optional(),
    language: z.string().trim().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/).max(10).optional(),
    logoUrl: z.string().url().max(2048).nullable().optional(),
    allowedDomains: z.array(domain).max(50).transform((items) => [...new Set(items)]).optional(),
    settings: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one tenant setting is required",
  });

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
