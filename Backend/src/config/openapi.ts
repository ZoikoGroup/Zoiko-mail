const jsonBody = (schema: Record<string, unknown>) => ({ required: true, content: { "application/json": { schema } } });
const bearer = [{ bearerAuth: [] }];
const ok = (description: string) => ({ description });

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Zoiko Mail API",
    version: "1.0.0",
    description: "Multi-tenant Zoiko Mail API. Tenant context is always derived from the verified access token.",
  },
  servers: [{ url: "http://localhost:5000", description: "Local development" }],
  tags: ["System", "Authentication", "Users", "Tenants", "Memberships", "Policies", "Mail", "Messages", "Threads", "Domains", "AI", "Actions", "Notifications", "Integrations", "Connectors", "Delivery Protection", "Lifecycle", "Support", "Audit"].map((name) => ({ name })),
  paths: {
    "/api/health": {
      get: { tags: ["System"], summary: "Health check", responses: { "200": ok("API is healthy") } },
    },
    "/api/ready": {
      get: { tags: ["System"], summary: "Database and local-storage readiness check", responses: { "200": ok("API dependencies are ready"), "500": ok("A required dependency is unavailable") } },
    },
    "/api/metrics": {
      get: {
        tags: ["System"], summary: "Prometheus metrics protected by x-operations-key",
        responses: { "200": { description: "Prometheus text exposition" }, "401": { description: "Operations authentication required" } },
      },
    },
    "/api/provider-mail/health": {
      get: {
        tags: ["System"], summary: "Inspect or probe IMAP/SMTP connectivity using x-operations-key",
        parameters: [
          { name: "x-operations-key", in: "header", required: true, schema: { type: "string" } },
          { name: "probe", in: "query", schema: { type: "boolean", default: false } },
        ],
        responses: { "200": ok("Safe provider status returned"), "401": { description: "Operations authentication required" }, "503": { description: "Provider is unconfigured or unavailable" } },
      },
    },
    "/api/provider-mail/sync": {
      post: {
        tags: ["System"], summary: "Queue an idempotent IMAP metadata sync for the configured tenant",
        parameters: [{ in: "header", name: "x-operations-key", required: true, schema: { type: "string" } }],
        responses: { "202": { description: "Sync queued" }, "401": { $ref: "#/components/responses/Unauthorized" } },
      },
    },
    "/api/v1/auth/register": {
      post: {
        tags: ["Authentication"], summary: "Register a user and tenant",
        requestBody: jsonBody({ $ref: "#/components/schemas/RegisterRequest" }),
        responses: { "201": ok("User, tenant, OWNER membership and session created"), "409": { $ref: "#/components/responses/Conflict" } },
      },
    },
    "/api/v1/auth/create-workspace": {
      post: {
        tags: ["Authentication"], summary: "Create a workspace for a pending (identity-only) user", security: bearer,
        description: "Send the pendingToken returned by POST /register as a Bearer token. Creates the Tenant + OWNER membership and returns a full session.",
        requestBody: jsonBody({
          type: "object",
          required: ["tenantName", "planCode"],
          properties: {
            tenantName: { type: "string", example: "Acme Inc" },
            planCode: { type: "string", example: "starter" },
          },
        }),
        responses: {
          "201": ok("Tenant, OWNER membership and session created"),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },

    "/api/v1/auth/verify-otp": {
      post: {
        tags: ["Authentication"], summary: "Verify the email OTP for a pending user", security: bearer,
        description: "Send the pendingToken from POST /register as a Bearer token. On success the user becomes ACTIVE and emailVerifiedAt is set; a refreshed pending token is returned.",
        requestBody: jsonBody({ type: "object", required: ["code"], properties: { code: { type: "string", example: "123456" } } }),
        responses: { "200": ok("Email verified; refreshed pending token returned"), "400": { $ref: "#/components/responses/ValidationError" }, "401": { $ref: "#/components/responses/Unauthorized" } },
      },
    },
    "/api/v1/auth/resend-otp": {
      post: {
        tags: ["Authentication"], summary: "Resend the email OTP for a pending user", security: bearer,
        description: "Send the pendingToken from POST /register as a Bearer token. Rate-limited by cooldown and hourly cap.",
        responses: { "200": ok("Code resent"), "401": { $ref: "#/components/responses/Unauthorized" }, "429": ok("Cooldown or hourly limit reached") },
      },
    },

    "/api/v1/auth/login": {
      post: {
        tags: ["Authentication"], summary: "Login or request tenant selection",
        requestBody: jsonBody({ $ref: "#/components/schemas/LoginRequest" }),
        responses: { "200": ok("Session or tenant selection returned"), "401": { $ref: "#/components/responses/Unauthorized" } },
      },
    },
    "/api/v1/auth/refresh": {
      post: {
        tags: ["Authentication"], summary: "Rotate refresh token",
        requestBody: jsonBody({ $ref: "#/components/schemas/RefreshTokenRequest" }),
        responses: { "200": ok("New access and refresh tokens"), "401": { $ref: "#/components/responses/Unauthorized" } },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        tags: ["Authentication"], summary: "Revoke one refresh token",
        requestBody: jsonBody({ $ref: "#/components/schemas/RefreshTokenRequest" }),
        responses: { "200": ok("Logged out") },
      },
    },
    "/api/v1/auth/me": {
      get: { tags: ["Authentication"], summary: "Get current session", security: bearer, responses: { "200": ok("Current session data") } },
    },
    "/api/v1/auth/change-password": {
      post: {
        tags: ["Authentication"], summary: "Change password and revoke refresh sessions", security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/ChangePasswordRequest" }),
        responses: { "200": ok("Password changed"), "401": { $ref: "#/components/responses/Unauthorized" } },
      },
    },
    "/api/v1/auth/logout-all": {
      post: { tags: ["Authentication"], summary: "Revoke all refresh sessions in this tenant", security: bearer, responses: { "200": ok("Sessions revoked") } },
    },
    "/api/v1/users/me": {
      get: { tags: ["Users"], summary: "Get own profile", security: bearer, responses: { "200": ok("Profile returned") } },
      patch: {
        tags: ["Users"], summary: "Update own profile", security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/UpdateProfileRequest" }),
        responses: { "200": ok("Profile updated"), "400": { $ref: "#/components/responses/ValidationError" } },
      },
    },
    "/api/v1/tenants/current": {
      get: { tags: ["Tenants"], summary: "Get JWT tenant settings", security: bearer, responses: { "200": ok("Tenant returned") } },
      patch: {
        tags: ["Tenants"], summary: "Update tenant settings (OWNER/ADMIN)", security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/UpdateTenantRequest" }),
        responses: { "200": ok("Tenant updated"), "403": { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/api/v1/membership/members": {
      get: { tags: ["Memberships"], summary: "List members (OWNER/ADMIN)", security: bearer, responses: { "200": ok("Members returned") } },
      post: {
        tags: ["Memberships"], summary: "Add an existing registered user", security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/AddMemberRequest" }),
        responses: { "201": ok("Membership created"), "409": { $ref: "#/components/responses/Conflict" } },
      },
    },
    "/api/v1/membership/members/{membershipId}": {
      parameters: [{ $ref: "#/components/parameters/MembershipId" }],
      patch: {
        tags: ["Memberships"], summary: "Update role or status", security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/UpdateMemberRequest" }),
        responses: { "200": ok("Membership updated"), "404": { $ref: "#/components/responses/NotFound" } },
      },
      delete: { tags: ["Memberships"], summary: "Soft-remove a member", security: bearer, responses: { "200": ok("Membership removed"), "409": { $ref: "#/components/responses/Conflict" } } },
    },
    "/api/v1/membership/invitations": {
      post: {
        tags: ["Memberships"], summary: "Create or rotate a time-limited invitation", security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/AddMemberRequest" }),
        responses: { "201": ok("Invitation created; raw token is returned once"), "409": { $ref: "#/components/responses/Conflict" } },
      },
    },
    "/api/v1/membership/invitations/accept": {
      post: {
        tags: ["Memberships"], summary: "Accept an invitation as its intended authenticated user", security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/AcceptInvitationRequest" }),
        responses: { "200": ok("Membership activated"), "401": { $ref: "#/components/responses/Unauthorized" }, "410": ok("Invitation expired") },
      },
    },
    "/api/v1/membership/invitations/{membershipId}": {
      delete: {
        tags: ["Memberships"], summary: "Cancel a pending invitation", security: bearer,
        parameters: [{ $ref: "#/components/parameters/MembershipId" }],
        responses: { "200": ok("Invitation cancelled"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/audit/events": {
      get: {
        tags: ["Audit"], summary: "List audit events (OWNER/ADMIN)", security: bearer,
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
          { name: "eventType", in: "query", schema: { type: "string" } },
          { name: "actorUserId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "targetType", in: "query", schema: { type: "string" } },
          { name: "targetId", in: "query", schema: { type: "string" } },
          { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
        ],
        responses: { "200": ok("Paginated events returned"), "403": { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/api/v1/policies": {
      get: { tags: ["Policies"], summary: "List versioned tenant policies (OWNER/ADMIN)", security: bearer, responses: { "200": ok("Policies returned") } },
      post: {
        tags: ["Policies"], summary: "Create a new draft policy version (OWNER/ADMIN)", security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/CreatePolicyRequest" }),
        responses: { "201": ok("Draft policy created") },
      },
    },
    "/api/v1/policies/evaluate": {
      post: {
        tags: ["Policies"], summary: "Evaluate the active tenant policy; fails closed if none exists", security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/EvaluatePolicyRequest" }),
        responses: { "200": ok("ALLOW or DENY decision returned") },
      },
    },
    "/api/v1/policies/retention/preview": {
      post: {
        tags: ["Policies"], summary: "Preview messages eligible under the active retention policy (OWNER)", security: bearer,
        responses: { "200": ok("Retention preview returned"), "409": { $ref: "#/components/responses/Conflict" } },
      },
    },
    "/api/v1/policies/retention/execute": {
      post: {
        tags: ["Policies"], summary: "Delete one preview-sized batch of retention-eligible messages (OWNER)", security: bearer,
        responses: { "200": ok("Retention cleanup completed"), "409": { $ref: "#/components/responses/Conflict" } },
      },
    },
    "/api/v1/policies/{policyId}": {
      get: {
        tags: ["Policies"], summary: "Get one tenant policy", security: bearer,
        parameters: [{ name: "policyId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Policy returned"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/policies/{policyId}/activate": {
      post: {
        tags: ["Policies"], summary: "Activate a policy and archive the previous active version", security: bearer,
        parameters: [{ name: "policyId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Policy activated") },
      },
    },
    "/api/v1/mail": {
      get: {
        tags: ["Mail"], summary: "List the current user's mailbox folder", security: bearer,
        parameters: [
          { name: "folder", in: "query", schema: { type: "string", enum: ["DRAFTS", "INBOX", "ARCHIVE", "SENT", "TRASH", "QUARANTINE"], default: "INBOX" } },
          { name: "starredOnly", in: "query", schema: { type: "boolean", default: false } },
          { name: "labelId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
        ],
        responses: { "200": ok("Mailbox items returned") },
      },
    },
    "/api/v1/messages": {
      get: {
        tags: ["Messages"], summary: "List and search messages accessible to the current mailbox", security: bearer,
        parameters: [
          { name: "folder", in: "query", schema: { type: "string", enum: ["DRAFTS", "INBOX", "ARCHIVE", "SENT", "TRASH"] } },
          { name: "q", in: "query", schema: { type: "string", maxLength: 200 } },
          { name: "unreadOnly", in: "query", schema: { type: "boolean", default: false } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
        ],
        responses: { "200": ok("Messages returned") },
      },
    },
    "/api/v1/messages/{messageId}": {
      get: {
        tags: ["Messages"], summary: "Get one accessible normalized message", security: bearer,
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Message returned"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/threads": {
      get: {
        tags: ["Threads"], summary: "List normalized conversation threads", security: bearer,
        parameters: [
          { name: "q", in: "query", schema: { type: "string", maxLength: 200 } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
        ],
        responses: { "200": ok("Threads returned") },
      },
    },
    "/api/v1/threads/{threadId}": {
      get: {
        tags: ["Threads"], summary: "Get an authorized thread timeline", security: bearer,
        parameters: [{ name: "threadId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Thread timeline returned"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/domains": {
      get: { tags: ["Domains"], summary: "List tenant domains", security: bearer, responses: { "200": ok("Domains returned") } },
      post: { tags: ["Domains"], summary: "Add a custom domain", security: bearer, responses: { "201": ok("Domain and verification record created") } },
    },
    "/api/v1/domains/{domainId}/diagnostics": {
      post: { tags: ["Domains"], summary: "Retry TXT, MX, SPF, DKIM and DMARC checks and store history", security: bearer, responses: { "200": ok("DNS diagnostics returned") } },
    },
    "/api/v1/domains/{domainId}/checks": {
      get: { tags: ["Domains"], summary: "List tenant-scoped DNS check history", security: bearer, responses: { "200": ok("DNS check history returned"), "404": { $ref: "#/components/responses/NotFound" } } },
    },
    "/api/v1/domains/{domainId}/activate": {
      post: { tags: ["Domains"], summary: "Enable sending after TXT, SPF, DKIM and DMARC pass", security: bearer, responses: { "200": ok("Domain sending activated"), "409": { $ref: "#/components/responses/Conflict" } } },
    },
    "/api/v1/ai/actions": {
      get: { tags: ["AI"], summary: "List the user's governed AI actions", security: bearer, responses: { "200": ok("AI actions returned") } },
      post: { tags: ["AI"], summary: "Request a policy-checked AI action without invoking a provider", security: bearer, responses: { "202": ok("AI action queued") } },
    },
    "/api/v1/actions": {
      get: { tags: ["Actions"], summary: "List owned commitments", security: bearer, responses: { "200": ok("Actions returned") } },
      post: { tags: ["Actions"], summary: "Create or assign a source-linked commitment", security: bearer, responses: { "201": ok("Action created") } },
    },
    "/api/v1/notifications": {
      get: { tags: ["Notifications"], summary: "List in-app notifications", security: bearer, responses: { "200": ok("Notifications returned") } },
    },
    "/api/v1/notifications/digests": {
      post: {
        tags: ["Notifications"], summary: "Queue an idempotent notification digest for the current user", security: bearer,
        responses: { "202": ok("Digest job queued") },
      },
    },
    "/api/v1/lifecycle/exports": {
      post: {
        tags: ["Lifecycle"], summary: "Queue an idempotent tenant data export (OWNER)", security: bearer,
        responses: { "202": ok("Export job queued") },
      },
    },
    "/api/v1/lifecycle/exports/{requestId}/download": {
      get: {
        tags: ["Lifecycle"], summary: "Download a completed tenant export (OWNER)", security: bearer,
        parameters: [{ name: "requestId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Tenant export JSON file" }, "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/lifecycle/deletions": {
      post: {
        tags: ["Lifecycle"], summary: "Request approval-gated tenant deletion (OWNER)", security: bearer,
        responses: { "202": ok("Deletion requested") },
      },
    },
    "/api/v1/lifecycle/{requestId}/confirm-deletion": {
      post: {
        tags: ["Lifecycle"], summary: "Finally confirm permanent tenant deletion using the exact tenant name (OWNER)", security: bearer,
        responses: { "202": ok("Deletion confirmed"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/lifecycle/{requestId}/cancel": {
      post: {
        tags: ["Lifecycle"], summary: "Cancel an unconfirmed tenant deletion request (OWNER)", security: bearer,
        responses: { "200": ok("Deletion cancelled"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/integrations": {
      get: { tags: ["Integrations"], summary: "List source-linked integration records", security: bearer, responses: { "200": ok("Integration links returned") } },
      post: { tags: ["Integrations"], summary: "Create a pending Zoiko integration link without external calls", security: bearer, responses: { "201": ok("Integration link created") } },
    },
    "/api/v1/connectors": {
      get: {
        tags: ["Connectors"], summary: "List the current member's read-only provider accounts",
        security: bearer, responses: { "200": ok("Connected accounts returned") },
      },
      post: {
        tags: ["Connectors"], summary: "Register a provider account mapping with approved read-only scopes",
        security: bearer,
        requestBody: jsonBody({
          type: "object", required: ["provider", "providerAccountId", "email", "scopes"],
          properties: {
            provider: { type: "string", enum: ["GMAIL", "MICROSOFT_365"] },
            providerAccountId: { type: "string", maxLength: 255 },
            email: { type: "string", format: "email" },
            scopes: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } },
          },
        }),
        responses: { "201": ok("Connected account mapping created"), "409": { $ref: "#/components/responses/Conflict" } },
      },
    },
    "/api/v1/connectors/{accountId}": {
      delete: {
        tags: ["Connectors"], summary: "Disconnect the current member's provider account",
        security: bearer,
        parameters: [{ name: "accountId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Account disconnected"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/connectors/{accountId}/events": {
      get: {
        tags: ["Connectors"], summary: "List sanitized normalized events for an owned account",
        security: bearer,
        parameters: [{ name: "accountId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Provider events returned"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/connectors/health": {
      get: {
        tags: ["Connectors"], summary: "Get tenant provider account and event health (OWNER/ADMIN)",
        security: bearer, responses: { "200": ok("Provider health returned") },
      },
    },
    "/api/v1/connectors/dead-letter": {
      get: {
        tags: ["Connectors"], summary: "List failed provider events requiring intervention (OWNER/ADMIN)",
        security: bearer, responses: { "200": ok("Dead-letter events returned") },
      },
    },
    "/api/v1/connectors/dead-letter/{eventId}/replay": {
      post: {
        tags: ["Connectors"], summary: "Replay a dead-letter provider event (OWNER/ADMIN)",
        security: bearer,
        parameters: [{ name: "eventId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Event queued for replay"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/connectors/callbacks/{provider}": {
      post: {
        tags: ["Connectors"], summary: "Receive a signed, rate-limited provider event callback",
        parameters: [
          { name: "provider", in: "path", required: true, schema: { type: "string", enum: ["GMAIL", "MICROSOFT_365"] } },
          { name: "x-provider-signature", in: "header", required: true, schema: { type: "string" } },
        ],
        responses: { "202": ok("Sanitized event accepted"), "200": ok("Duplicate event acknowledged"), "401": { $ref: "#/components/responses/Unauthorized" } },
      },
    },
    "/api/v1/delivery-protection/suppressions": {
      get: {
        tags: ["Delivery Protection"], summary: "List active hashed recipient suppressions (OWNER/ADMIN)",
        security: bearer, responses: { "200": ok("Suppressions returned") },
      },
      post: {
        tags: ["Delivery Protection"], summary: "Add an administrative recipient suppression (OWNER/ADMIN)",
        security: bearer,
        requestBody: jsonBody({
          type: "object", required: ["email"],
          properties: { email: { type: "string", format: "email" }, reason: { type: "string", enum: ["ADMIN"], default: "ADMIN" } },
        }),
        responses: { "201": ok("Hashed suppression created") },
      },
    },
    "/api/v1/delivery-protection/suppressions/{suppressionId}": {
      delete: {
        tags: ["Delivery Protection"], summary: "Deactivate a recipient suppression (OWNER/ADMIN)",
        security: bearer,
        parameters: [{ name: "suppressionId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Suppression deactivated"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/delivery-protection/mailboxes/{mailboxId}/warmup": {
      get: {
        tags: ["Delivery Protection"], summary: "Get mailbox warm-up stage, cap and reputation rates",
        security: bearer,
        parameters: [{ name: "mailboxId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Warm-up status returned"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/delivery-protection/mailboxes/{mailboxId}/warmup/evaluate": {
      post: {
        tags: ["Delivery Protection"], summary: "Promote a mailbox that meets clean-sending thresholds",
        security: bearer,
        parameters: [{ name: "mailboxId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Mailbox promoted"), "409": { $ref: "#/components/responses/Conflict" } },
      },
    },
    "/api/v1/support/access-grants": {
      get: { tags: ["Support"], summary: "List support access grants (OWNER)", security: bearer, responses: { "200": ok("Grants returned") } },
      post: { tags: ["Support"], summary: "Create a time-limited support grant (OWNER)", security: bearer, responses: { "201": ok("Grant created") } },
    },
    "/api/v1/support/diagnostics": {
      get: { tags: ["Support"], summary: "Access scoped diagnostics using x-support-grant-id", security: bearer, responses: { "200": ok("Scoped diagnostics returned"), "403": { $ref: "#/components/responses/Forbidden" } } },
    },
    "/api/v1/mail/drafts": {
      post: {
        tags: ["Mail"], summary: "Create a draft", security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/CreateDraftRequest" }),
        responses: { "201": ok("Draft created") },
      },
    },
    "/api/v1/mail/drafts/{messageId}": {
      patch: {
        tags: ["Mail"], summary: "Update an owned draft", security: bearer,
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: jsonBody({ $ref: "#/components/schemas/CreateDraftRequest" }),
        responses: { "200": ok("Draft updated"), "404": { $ref: "#/components/responses/NotFound" } },
      },
      delete: {
        tags: ["Mail"], summary: "Delete an owned draft and its stored attachments", security: bearer,
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Draft deleted"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/mail/trash": {
      delete: {
        tags: ["Mail"], summary: "Permanently remove all messages from the current mailbox Trash", security: bearer,
        responses: { "200": ok("Trash emptied") },
      },
    },
    "/api/v1/mail/bulk": {
      patch: {
        tags: ["Mail"], summary: "Apply a mailbox action to up to 100 authorized messages", security: bearer,
        requestBody: jsonBody({
          type: "object",
          required: ["messageIds", "action"],
          properties: {
            messageIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", format: "uuid" } },
            action: { type: "string", enum: ["MARK_READ", "MARK_UNREAD", "STAR", "UNSTAR", "ARCHIVE", "TRASH", "RESTORE"] },
          },
        }),
        responses: { "200": ok("Bulk action completed"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/mail/labels": {
      get: {
        tags: ["Mail"], summary: "List labels belonging to the current mailbox", security: bearer,
        responses: { "200": ok("Labels returned") },
      },
      post: {
        tags: ["Mail"], summary: "Create a custom mailbox label", security: bearer,
        requestBody: jsonBody({
          type: "object", required: ["name", "color"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 50 },
            color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
          },
        }),
        responses: { "201": ok("Label created"), "409": { $ref: "#/components/responses/Conflict" } },
      },
    },
    "/api/v1/mail/labels/{labelId}": {
      patch: {
        tags: ["Mail"], summary: "Update a label belonging to the current mailbox", security: bearer,
        parameters: [{ name: "labelId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Label updated"), "404": { $ref: "#/components/responses/NotFound" } },
      },
      delete: {
        tags: ["Mail"], summary: "Delete a label and remove its message assignments", security: bearer,
        parameters: [{ name: "labelId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Label deleted"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/mail/{messageId}/labels/{labelId}": {
      put: {
        tags: ["Mail"], summary: "Assign a mailbox label to an authorized message", security: bearer,
        responses: { "200": ok("Label assigned"), "404": { $ref: "#/components/responses/NotFound" } },
      },
      delete: {
        tags: ["Mail"], summary: "Remove a mailbox label from an authorized message", security: bearer,
        responses: { "200": ok("Label removed"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/mail/drafts/{messageId}/send": {
      post: {
        tags: ["Mail"], summary: "Send a draft after tenant policy evaluation", security: bearer,
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Internal recipients delivered and external recipients queued"), "403": { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/api/v1/mail/drafts/{messageId}/schedule": {
      post: {
        tags: ["Mail"], summary: "Schedule an owned draft for policy-checked delivery", security: bearer,
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: jsonBody({
          type: "object", required: ["scheduledAt"],
          properties: { scheduledAt: { type: "string", format: "date-time" } },
        }),
        responses: { "202": ok("Draft scheduled"), "404": { $ref: "#/components/responses/NotFound" } },
      },
      delete: {
        tags: ["Mail"], summary: "Cancel scheduled delivery and return the message to draft state", security: bearer,
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Schedule cancelled"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/mail/drafts/{messageId}/attachments": {
      post: {
        tags: ["Mail"], summary: "Upload one attachment to an owned draft", security: bearer,
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object", required: ["file"],
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: { "201": ok("Attachment uploaded"), "413": { description: "File or mailbox quota exceeded" }, "415": { description: "File type not allowed" } },
      },
    },
    "/api/v1/mail/{messageId}/attachments/{attachmentId}": {
      get: {
        tags: ["Mail"], summary: "Download an authorized message attachment", security: bearer,
        parameters: [
          { name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "attachmentId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Attachment bytes" }, "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/mail/{messageId}/delivery-events": {
      get: {
        tags: ["Mail"], summary: "List delivery events for a message authored by the current user", security: bearer,
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Delivery events returned"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/mail/admin/mailboxes/{mailboxId}/sending": {
      patch: {
        tags: ["Mail"], summary: "Suspend or resume mailbox sending (OWNER/ADMIN)", security: bearer,
        parameters: [{ name: "mailboxId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object", required: ["suspended"],
                properties: {
                  suspended: { type: "boolean" },
                  reason: { type: "string", minLength: 3, maxLength: 500 },
                },
              },
            },
          },
        },
        responses: { "200": ok("Mailbox sending status updated"), "403": { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/api/v1/mail/drafts/{messageId}/attachments/{attachmentId}": {
      delete: {
        tags: ["Mail"], summary: "Delete an attachment from an owned draft", security: bearer,
        parameters: [
          { name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "attachmentId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": ok("Attachment deleted"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/mail/{messageId}": {
      get: {
        tags: ["Mail"], summary: "Get a message from the current user's mailbox", security: bearer,
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Message returned"), "404": { $ref: "#/components/responses/NotFound" } },
      },
      patch: {
        tags: ["Mail"], summary: "Mark read/starred, archive, trash, or restore a mailbox message", security: bearer,
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: jsonBody({ $ref: "#/components/schemas/UpdateMailboxItemRequest" }),
        responses: { "200": ok("Mailbox item updated") },
      },
      delete: {
        tags: ["Mail"], summary: "Permanently remove a trashed message from the current mailbox", security: bearer,
        parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Trashed message deleted"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/v1/mail/{messageId}/reply": {
      post: { tags: ["Mail"], summary: "Create a reply draft in the existing thread", security: bearer, responses: { "201": ok("Reply draft created"), "404": { $ref: "#/components/responses/NotFound" } } },
    },
    "/api/v1/mail/{messageId}/reply-all": {
      post: { tags: ["Mail"], summary: "Create a reply-all draft without BCC disclosure", security: bearer, responses: { "201": ok("Reply-all draft created"), "404": { $ref: "#/components/responses/NotFound" } } },
    },
    "/api/v1/mail/{messageId}/forward": {
      post: { tags: ["Mail"], summary: "Create a forwarded-message draft in a new thread", security: bearer, responses: { "201": ok("Forward draft created"), "404": { $ref: "#/components/responses/NotFound" } } },
    },
    "/api/v1/audit/events/{eventId}": {
      get: {
        tags: ["Audit"], summary: "Get one audit event", security: bearer,
        parameters: [{ name: "eventId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": ok("Event returned"), "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    parameters: { MembershipId: { name: "membershipId", in: "path", required: true, schema: { type: "string", format: "uuid" } } },
    responses: {
      ValidationError: { description: "Request validation failed" }, Unauthorized: { description: "Authentication failed" },
      Forbidden: { description: "Tenant or role access denied" }, NotFound: { description: "Tenant-scoped resource not found" }, Conflict: { description: "Resource state conflict" },
    },
    schemas: {
      RegisterRequest: {
        type: "object", required: ["email", "password", "displayName", "tenantName"],
        properties: { email: { type: "string", format: "email" }, password: { type: "string", format: "password", minLength: 8 }, displayName: { type: "string" }, tenantName: { type: "string" }, planCode: { type: "string", default: "starter" } },
      },
      LoginRequest: {
        type: "object", required: ["email", "password"],
        properties: { email: { type: "string", format: "email" }, password: { type: "string", format: "password" }, tenantId: { type: "string", format: "uuid" } },
      },
      RefreshTokenRequest: { type: "object", required: ["refreshToken"], properties: { refreshToken: { type: "string" } } },
      ChangePasswordRequest: {
        type: "object", required: ["currentPassword", "newPassword"],
        properties: { currentPassword: { type: "string", format: "password" }, newPassword: { type: "string", format: "password", minLength: 8 } },
      },
      UpdateProfileRequest: {
        type: "object", minProperties: 1,
        properties: { displayName: { type: "string" }, avatarUrl: { type: "string", format: "uri", nullable: true }, phoneNumber: { type: "string", nullable: true }, timezone: { type: "string", example: "Asia/Kolkata" }, language: { type: "string", example: "en-IN" } },
      },
      UpdateTenantRequest: {
        type: "object", minProperties: 1,
        properties: { name: { type: "string" }, timezone: { type: "string" }, language: { type: "string" }, logoUrl: { type: "string", format: "uri", nullable: true }, allowedDomains: { type: "array", items: { type: "string" } }, settings: { type: "object", additionalProperties: true, nullable: true } },
      },
      AddMemberRequest: {
        type: "object", required: ["email", "role"], properties: { email: { type: "string", format: "email" }, role: { $ref: "#/components/schemas/MembershipRole" } },
      },
      UpdateMemberRequest: {
        type: "object", minProperties: 1, properties: { role: { $ref: "#/components/schemas/MembershipRole" }, status: { type: "string", enum: ["ACTIVE", "SUSPENDED"] } },
      },
      AcceptInvitationRequest: {
        type: "object", required: ["invitationToken"], properties: { invitationToken: { type: "string", minLength: 32 } },
      },
      MembershipRole: { type: "string", enum: ["OWNER", "ADMIN", "MEMBER", "SUPPORT"] },
      CreatePolicyRequest: {
        type: "object", required: ["type", "name", "rules"],
        properties: {
          type: { type: "string", enum: ["AI", "SENDING", "RETENTION", "DELETION", "ABUSE"] },
          name: { type: "string" }, description: { type: "string", nullable: true },
          rules: { $ref: "#/components/schemas/PolicyRules" },
        },
      },
      EvaluatePolicyRequest: {
        type: "object", required: ["type", "context"],
        properties: { type: { type: "string", enum: ["AI", "SENDING", "RETENTION", "DELETION", "ABUSE"] }, context: { type: "object", additionalProperties: true } },
      },
      PolicyRules: {
        type: "object", required: ["defaultEffect"],
        properties: {
          defaultEffect: { type: "string", enum: ["ALLOW", "DENY"] },
          conditions: { type: "array", items: { type: "object", required: ["field", "operator", "value", "effect"], properties: { field: { type: "string" }, operator: { type: "string", enum: ["EQUALS", "NOT_EQUALS", "IN", "GREATER_THAN", "GREATER_THAN_OR_EQUAL", "LESS_THAN", "LESS_THAN_OR_EQUAL"] }, value: {}, effect: { type: "string", enum: ["ALLOW", "DENY"] } } } },
        },
      },
      CreateDraftRequest: {
        type: "object", required: ["recipients"],
        properties: {
          subject: { type: "string", maxLength: 998 },
          textBody: { type: "string", nullable: true },
          htmlBody: { type: "string", nullable: true },
          recipients: {
            type: "object", required: ["to"],
            properties: {
              to: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", format: "email" } },
              cc: { type: "array", maxItems: 100, items: { type: "string", format: "email" } },
              bcc: { type: "array", maxItems: 100, items: { type: "string", format: "email" } },
            },
          },
        },
      },
      UpdateMailboxItemRequest: {
        type: "object", minProperties: 1,
        properties: { isRead: { type: "boolean" }, folder: { type: "string", enum: ["INBOX", "TRASH"] } },
      },
    },
  },
} as const;
