import { z } from "zod";

// An empty field from a form means "not set", not an empty string stored.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

// Digits, spaces and the usual phone punctuation; at least five digits.
const phone = z
  .string()
  .trim()
  .max(30)
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine((value) => value === undefined || (/^[+0-9 ().\-/x]+$/i.test(value) && (value.match(/\d/g)?.length ?? 0) >= 5), {
    message: "Enter a valid phone number",
  });

const tags = z.array(z.string().trim().min(1).max(50)).max(20);

// ── Create ──────────────────────────────────────────────────────────────────
export const createContactSchema = z.object({
  firstName: optionalText(120),
  lastName: optionalText(120),
  email: z.string().trim().email("Enter a valid email address").max(254),
  phone,
  company: optionalText(200),
  jobTitle: optionalText(200),
  notes: optionalText(2000),
  tags: tags.default([]),
  avatarUrl: z.string().url().max(2048).nullable().optional(),
  isFavorite: z.boolean().optional(),
  visibility: z.enum(["PERSONAL", "SHARED"]).optional(),
  // MAIL when saved from Other Contacts. IMPORT is set by the import route only.
  source: z.enum(["MANUAL", "MAIL"]).optional(),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

// ── Update (partial) ────────────────────────────────────────────────────────
// Clearing a field sends null, so it is stored as cleared rather than ignored.
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
export const updateContactSchema = z
  .object({
    firstName: nullableText(120),
    lastName: nullableText(120),
    email: z.string().trim().email("Enter a valid email address").max(254).optional(),
    phone: z
      .string()
      .trim()
      .max(30)
      .nullable()
      .optional()
      .refine((value) => !value || (/^[+0-9 ().\-/x]+$/i.test(value) && (value.match(/\d/g)?.length ?? 0) >= 5), {
        message: "Enter a valid phone number",
      }),
    company: nullableText(200),
    jobTitle: nullableText(200),
    notes: nullableText(2000),
    tags: tags.optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
    isFavorite: z.boolean().optional(),
    visibility: z.enum(["PERSONAL", "SHARED"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

// ── List / Search ───────────────────────────────────────────────────────────
export const CONTACT_SCOPES = ["all", "mine", "personal", "shared", "favorites"] as const;
export const CONTACT_SORTS = ["name", "company", "recent"] as const;
export const listContactsSchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  tag: z.string().trim().min(1).max(50).optional(),
  // all: my contacts plus contacts others share with the workspace.
  // personal: mine that are not shared.
  scope: z.enum(CONTACT_SCOPES).default("mine"),
  sort: z.enum(CONTACT_SORTS).default("name"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListContactsInput = z.infer<typeof listContactsSchema>;

export const searchSchema = z.object({
  q: z.string().trim().max(200).default(""),
});

export const activitySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

// ── Import ──────────────────────────────────────────────────────────────────
// Rows are checked one by one, so one bad row is reported, not fatal.
export const importContactsSchema = z.object({
  contacts: z
    .array(
      z.object({
        firstName: z.string().max(500).optional(),
        lastName: z.string().max(500).optional(),
        email: z.string().max(500),
        phone: z.string().max(500).optional(),
        company: z.string().max(500).optional(),
        jobTitle: z.string().max(500).optional(),
        notes: z.string().max(5000).optional(),
        tags: z.array(z.string().max(500)).max(50).optional(),
      })
    )
    .min(1, "The file has no contacts")
    .max(1000, "Import at most 1,000 contacts at a time"),
});
export type ImportContactsInput = z.infer<typeof importContactsSchema>;

// ── Merge ───────────────────────────────────────────────────────────────────
export const mergeContactsSchema = z
  .object({
    keepId: z.string().uuid(),
    mergeIds: z.array(z.string().uuid()).min(1).max(20),
  })
  .refine((v) => !v.mergeIds.includes(v.keepId), { message: "A contact cannot be merged into itself" });
export type MergeContactsInput = z.infer<typeof mergeContactsSchema>;

// ── Params ──────────────────────────────────────────────────────────────────
export const contactIdParamsSchema = z.object({
  contactId: z.string().uuid(),
});
