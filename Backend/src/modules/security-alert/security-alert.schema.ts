import { z } from "zod";
import {
  ALERT_REVIEW_ACTIONS,
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