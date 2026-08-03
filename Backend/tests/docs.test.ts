import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("API documentation", () => {
  it("serves a complete OpenAPI document", async () => {
    const response = await request(app).get("/api/docs.json").expect(200);
    expect(response.body.openapi).toBe("3.0.3");
    expect(response.body.paths).toHaveProperty("/api/v1/auth/login");
    expect(response.body.paths).toHaveProperty("/api/metrics");
    expect(response.body.paths).toHaveProperty("/api/v1/membership/members");
    expect(response.body.paths).toHaveProperty("/api/v1/membership/invitations");
    expect(response.body.paths).toHaveProperty("/api/v1/membership/invitations/accept");
    expect(response.body.paths).toHaveProperty("/api/v1/users/me");
    expect(response.body.paths).toHaveProperty("/api/v1/tenants/current");
    expect(response.body.paths).toHaveProperty("/api/v1/audit/events");
    expect(response.body.paths).toHaveProperty("/api/v1/policies");
    expect(response.body.paths).toHaveProperty("/api/v1/policies/evaluate");
    expect(response.body.paths).toHaveProperty("/api/v1/policies/retention/preview");
    expect(response.body.paths).toHaveProperty("/api/v1/policies/retention/execute");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/drafts");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/drafts/{messageId}");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/trash");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/bulk");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/labels");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/labels/{labelId}");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/{messageId}/labels/{labelId}");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/drafts/{messageId}/send");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/drafts/{messageId}/schedule");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/drafts/{messageId}/attachments");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/{messageId}/attachments/{attachmentId}");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/{messageId}/delivery-events");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/admin/mailboxes/{mailboxId}/sending");
    expect(response.body.paths).toHaveProperty("/api/v1/messages");
    expect(response.body.paths).toHaveProperty("/api/v1/messages/{messageId}");
    expect(response.body.paths).toHaveProperty("/api/v1/threads");
    expect(response.body.paths).toHaveProperty("/api/v1/threads/{threadId}");
    expect(response.body.paths).toHaveProperty("/api/v1/domains");
    expect(response.body.paths).toHaveProperty("/api/v1/ai/actions");
    expect(response.body.paths).toHaveProperty("/api/v1/actions");
    expect(response.body.paths).toHaveProperty("/api/v1/notifications");
    expect(response.body.paths).toHaveProperty("/api/v1/notifications/digests");
    expect(response.body.paths).toHaveProperty("/api/v1/lifecycle/exports");
    expect(response.body.paths).toHaveProperty("/api/v1/lifecycle/exports/{requestId}/download");
    expect(response.body.paths).toHaveProperty("/api/v1/lifecycle/deletions");
    expect(response.body.paths).toHaveProperty("/api/v1/lifecycle/{requestId}/confirm-deletion");
    expect(response.body.paths).toHaveProperty("/api/v1/lifecycle/{requestId}/cancel");
    expect(response.body.paths).toHaveProperty("/api/v1/integrations");
    expect(response.body.paths).toHaveProperty("/api/v1/support/access-grants");
    expect(response.body.paths).toHaveProperty("/api/v1/support/diagnostics");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/{messageId}/reply");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/{messageId}/reply-all");
    expect(response.body.paths).toHaveProperty("/api/v1/mail/{messageId}/forward");
    expect(response.body.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });

  it("serves the interactive Swagger UI", async () => {
    const response = await request(app).get("/api/docs/").expect(200);
    expect(response.text).toContain("Zoiko Mail API Docs");
    expect(response.text).toContain('id="swagger-ui"');
  });
});
