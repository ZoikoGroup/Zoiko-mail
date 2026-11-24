import { z } from "zod";
import {
  ALERT_REVIEW_ACTIONS,
  REMEDIATION_ACTIONS,
} from "./security-alert.types.js";

export const securityAlertQuerySchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]).optional(),
  type: z
    .enum([
      "NEW_DEVICE_LOGIN",
      "FAILED_LOGIN_BURST",
      "REFRESH_TOKEN_REUSE",
      "PASSWORD_CHANGED",
      "PASSWORD_RESET",
      "FORWARDING_EXTERNAL",
      "MAILBOX_ACCESS_GRANTED",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const securityAlertParamsSchema = z.object({
  alertId: z.string().uuid(),
});

export const securityAlertReviewSchema = z.object({
  action: z.enum(ALERT_REVIEW_ACTIONS as unknown as [string, ...string[]]),
  note: z.string().max(500).optional(),
});

export const securityAlertRemediationSchema = z
  .object({
    action: z.enum(REMEDIATION_ACTIONS as unknown as [string, ...string[]]),
    note: z.string().trim().max(500).optional(),
  })
  // Strict: an unknown field is a client asking for something this does not do.
  .strict();