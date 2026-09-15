import { z } from "zod";

// ── Create ──────────────────────────────────────────────────────────────────
export const createContactSchema = z.object({
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(30).optional(),
  company: z.string().trim().max(200).optional(),
  jobTitle: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  avatarUrl: z.string().url().max(2048).nullable().optional(),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

// ── Update (partial) ────────────────────────────────────────────────────────
export const updateContactSchema = createContactSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "At least one field is required" }
);
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

// ── List / Search ───────────────────────────────────────────────────────────
export const listContactsSchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  tag: z.string().trim().min(1).max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListContactsInput = z.infer<typeof listContactsSchema>;

// ── Params ──────────────────────────────────────────────────────────────────
export const contactIdParamsSchema = z.object({
  contactId: z.string().uuid(),
});