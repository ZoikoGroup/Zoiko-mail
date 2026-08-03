import { z } from "zod";

const timezone = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "Invalid IANA timezone");

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
    phoneNumber: z.string().trim().regex(/^\+?[1-9]\d{6,14}$/, "Invalid phone number").nullable().optional(),
    timezone: timezone.optional(),
    language: z.string().trim().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/).max(10).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field is required",
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
