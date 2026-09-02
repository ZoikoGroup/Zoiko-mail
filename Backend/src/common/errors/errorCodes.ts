export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  TENANT_SELECTION_REQUIRED: "TENANT_SELECTION_REQUIRED",
  TOKEN_INVALID: "TOKEN_INVALID",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_REUSED: "TOKEN_REUSED",
  // The caller signed into a different workspace, which ends every session
  // for the previous one. Distinct from UNAUTHORIZED so the client can say
  // what happened instead of showing an unexplained sign-out.
  SESSION_SUPERSEDED: "SESSION_SUPERSEDED",
  // The session belongs to a different console than the one being used. A
  // fresh sign-in aimed at that console is the only way in; the client shows
  // this as "sign in again" rather than as a permissions failure.
  WORKSPACE_MISMATCH: "WORKSPACE_MISMATCH",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  INVITATION_INVALID: "INVITATION_INVALID",
  INVITATION_EXPIRED: "INVITATION_EXPIRED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  FEATURE_DISABLED: "FEATURE_DISABLED",
  OTP_INVALID: "OTP_INVALID",
  OTP_EXPIRED: "OTP_EXPIRED",
  OTP_MAX_ATTEMPTS: "OTP_MAX_ATTEMPTS",
  OTP_RESEND_LIMIT: "OTP_RESEND_LIMIT",
  OTP_COOLDOWN: "OTP_COOLDOWN",
  EMAIL_ALREADY_VERIFIED: "EMAIL_ALREADY_VERIFIED",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  USER_SUSPENDED: "USER_SUSPENDED",
  USER_DISABLED: "USER_DISABLED",
  MEMBERSHIP_SUSPENDED: "MEMBERSHIP_SUSPENDED",
  TENANT_SUSPENDED: "TENANT_SUSPENDED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
