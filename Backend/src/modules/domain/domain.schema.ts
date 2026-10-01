import { z } from "zod";
export const domainIdSchema = z.object({ domainId: z.string().uuid() });
export const credentialIdSchema = z.object({ credentialId: z.string().uuid() });

const domainName = z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]+\.)+[a-z]{2,63}$/);

/** Everything a domain's generated records are derived from. */
const configFields = {
  dnsProvider: z.enum(["MANUAL", "CLOUDFLARE", "GODADDY"]).optional(),
  dnsCredentialId: z.string().uuid().nullable().optional(),
  receivingEnabled: z.boolean().optional(),
  replaceExistingMx: z.boolean().optional(),
  autoActivateSending: z.boolean().optional(),
  dmarcPolicy: z.enum(["NONE", "QUARANTINE", "REJECT"]).optional(),
  dmarcReportEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
};

export const addDomainSchema = z.object({ domainName, ...configFields }).strict();

export const updateDomainSchema = z.object(configFields).strict().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  "Nothing to update"
);

/**
 * Credentials are write-only: they are accepted here and never returned.
 * Bounded lengths keep a pasted blob from being written to the secret store.
 */
export const connectProviderSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("CLOUDFLARE"),
    label: z.string().trim().min(1).max(80),
    apiToken: z.string().trim().min(20).max(200),
  }).strict(),
  z.object({
    provider: z.literal("GODADDY"),
    label: z.string().trim().min(1).max(80),
    apiKey: z.string().trim().min(8).max(200),
    apiSecret: z.string().trim().min(8).max(200),
    environment: z.enum(["PRODUCTION", "OTE"]).optional(),
  }).strict(),
]);

/** Cursor pagination — API §4. Shared so every list answers the same way. */
export { paginationQuerySchema as listQuerySchema } from "../../common/utils/pagination.js";
