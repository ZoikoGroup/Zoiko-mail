import { z } from "zod";

export const connectorProviderSchema = z.enum(["GMAIL", "MICROSOFT_365"]);

const allowedScopes = {
  GMAIL: new Set(["https://www.googleapis.com/auth/gmail.readonly"]),
  MICROSOFT_365: new Set(["Mail.Read", "offline_access", "openid", "profile"]),
} as const;

export const createConnectedAccountSchema = z.object({
  provider: connectorProviderSchema,
  providerAccountId: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(320),
  scopes: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
}).superRefine((value, context) => {
  const approved = allowedScopes[value.provider];
  value.scopes.forEach((scope, index) => {
    if (!approved.has(scope as never)) {
      context.addIssue({
        code: "custom",
        path: ["scopes", index],
        message: `Scope is not approved for read-only ${value.provider} access`,
      });
    }
  });
  const required = value.provider === "GMAIL"
    ? "https://www.googleapis.com/auth/gmail.readonly"
    : "Mail.Read";
  if (!value.scopes.includes(required)) {
    context.addIssue({
      code: "custom",
      path: ["scopes"],
      message: `Required read-only scope ${required} is missing`,
    });
  }
});

export const connectedAccountIdSchema = z.object({
  accountId: z.string().uuid(),
});

export const providerEventIdSchema = z.object({
  eventId: z.string().uuid(),
});

export const callbackParamsSchema = z.object({
  provider: connectorProviderSchema,
});

export const providerCallbackSchema = z.object({
  providerEventId: z.string().trim().min(1).max(255).optional(),
  providerAccountId: z.string().trim().min(1).max(255),
  eventType: z.string().trim().min(1).max(100).regex(/^[A-Z0-9_.-]+$/i),
  resourceType: z.string().trim().min(1).max(100).optional(),
  resourceId: z.string().trim().min(1).max(255).optional(),
  providerReference: z.string().trim().min(1).max(255).optional(),
  occurredAt: z.string().datetime(),
  cursor: z.string().trim().min(1).max(1024).optional(),
});

export const listProviderEventsQuerySchema = z.object({
  status: z.enum(["RECEIVED", "RETRY", "PROCESSED", "FAILED", "DEAD_LETTER"]).optional(),
  provider: z.enum(["GMAIL", "MICROSOFT_365", "IMAP_SMTP"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
