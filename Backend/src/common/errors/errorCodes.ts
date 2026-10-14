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
  WORKSPACE_ACCESS_DENIED: "WORKSPACE_ACCESS_DENIED",
  // API §7. Distinct codes because the three failures need three different
  // client behaviours: send a key, stop reusing this one, or wait and re-read.
  IDEMPOTENCY_KEY_REQUIRED: "IDEMPOTENCY_KEY_REQUIRED",
  IDEMPOTENCY_PAYLOAD_MISMATCH: "IDEMPOTENCY_PAYLOAD_MISMATCH",
  IDEMPOTENCY_REQUEST_IN_PROGRESS: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
  // A DNS host's API refused or failed a request. Separate from a validation
  // error: the input was fine, and the fix is on the provider's side.
  DNS_PROVIDER_ERROR: "DNS_PROVIDER_ERROR",
  // Hosted mailboxes. Not configured is a deployment state the client can
  // explain; it is never answered by creating a database-only mailbox.
  MAIL_HOSTING_NOT_CONFIGURED: "MAIL_HOSTING_NOT_CONFIGURED",
  PROVISIONING_IN_PROGRESS: "PROVISIONING_IN_PROGRESS",
  // Deleting a hosted mailbox: the host could not be asked (or its answer
  // could not be trusted), the mailbox still holds mail, or the deployment has
  // not enabled deletion. Every one of these deletes nothing.
  MAIL_HOSTING_UNAVAILABLE: "MAIL_HOSTING_UNAVAILABLE",
  MAILBOX_NOT_EMPTY: "MAILBOX_NOT_EMPTY",
  MAILBOX_DELETE_DISABLED: "MAILBOX_DELETE_DISABLED",
  // The mail server refused or failed a credential change. Nothing was
  // changed in Zoiko either, so the two never disagree about the password.
  MAIL_SERVER_SYNC_FAILED: "MAIL_SERVER_SYNC_FAILED",
  // The mailbox exists but is not assigned to the workspace this session was
  // opened for. Distinct from FORBIDDEN so the client can say which console
  // to use instead of showing a bare permission failure.
  MAILBOX_NOT_IN_WORKSPACE: "MAILBOX_NOT_IN_WORKSPACE",
  // The session is for an Admin, Owner or Support console that an admin has
  // since removed from this person's mailbox. The client signs out with the
  // message rather than retrying, because a refresh would be refused too.
  WORKSPACE_ACCESS_NOT_ASSIGNED: "WORKSPACE_ACCESS_NOT_ASSIGNED",
  // The database could not be reached or the connection pool was exhausted.
  // Temporary by nature, so a 503 the client can retry rather than a 500.
  DATABASE_UNAVAILABLE: "DATABASE_UNAVAILABLE",
  // A Member sign-in link that matches no mailbox: mistyped, or regenerated.
  MEMBER_LOGIN_LINK_INVALID: "MEMBER_LOGIN_LINK_INVALID",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
