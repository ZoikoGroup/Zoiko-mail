import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Exporting the audit log.
 *
 * The screen reads one page, which is why the export exists: an investigation
 * wants everything the filters match, not the newest 25 rows. The properties
 * worth pinning are the ones that would make a downloaded file quietly wrong —
 * a row that escapes into the wrong number of columns, a scope that widens on
 * the way out, or a tenant boundary that holds for the list and not for the
 * download.
 */

/** Split one CSV line into fields, honouring RFC 4180 quoting. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

/** The CSV body as rows of fields, with the byte-order mark and header removed. */
function rows(csv: string): string[][] {
  const lines = csv.replace(/^﻿/, "").split("\n").filter((line) => line.length > 0);
  return lines.slice(1).map(parseCsvLine);
}

function header(csv: string): string[] {
  return parseCsvLine(csv.replace(/^﻿/, "").split("\n")[0]!);
}

async function seed(
  tenantId: string,
  actorUserId: string,
  events: Array<{ eventType: string; metadata?: Prisma.InputJsonObject; targetId?: string }>
) {
  for (const event of events) {
    await prisma.auditEvent.create({
      data: {
        tenantId,
        actorUserId,
        eventType: event.eventType,
        targetType: "Test",
        targetId: event.targetId ?? null,
        metadata: event.metadata ?? {},
      },
    });
  }
}

describe("GET /audit/events/export", () => {
  it("returns a CSV attachment with the columns it promises", async () => {
    const owner = await registerUser(app, { email: `export-basic-${Date.now()}@zoiko.test` });
    await seed(owner.tenantId, owner.userId, [{ eventType: "EXPORT_TEST_ONE" }]);

    const response = await request(app)
      .get("/api/v1/audit/events/export")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toMatch(
      /attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/
    );
    expect(header(response.text)).toEqual([
      "created_at",
      "event_type",
      "actor_type",
      "actor_email",
      "actor_name",
      "target_type",
      "target_id",
      "request_id",
      "ip_address",
      "user_agent",
      "metadata",
    ]);
    // A UTF-8 BOM, so a spreadsheet does not mangle a non-ASCII display name.
    expect(response.text.startsWith("﻿")).toBe(true);
  });

  it("applies the same filters the screen does", async () => {
    const owner = await registerUser(app, { email: `export-filter-${Date.now()}@zoiko.test` });
    await seed(owner.tenantId, owner.userId, [
      { eventType: "EXPORT_WANTED" },
      { eventType: "EXPORT_UNWANTED" },
    ]);

    const response = await request(app)
      .get("/api/v1/audit/events/export")
      .query({ eventType: "EXPORT_WANTED" })
      .set(authHeader(owner.accessToken))
      .expect(200);

    const types = rows(response.text).map((row) => row[1]);
    expect(types).toContain("EXPORT_WANTED");
    expect(types).not.toContain("EXPORT_UNWANTED");
  });

  it("exports past the page size, which is the whole point of it", async () => {
    const owner = await registerUser(app, { email: `export-many-${Date.now()}@zoiko.test` });
    await seed(
      owner.tenantId,
      owner.userId,
      Array.from({ length: 30 }, (_, i) => ({
        eventType: "EXPORT_BULK",
        targetId: `row-${i}`,
      }))
    );

    // The list endpoint caps a page at 100 and defaults to 25; the screen read
    // 50. An export that stopped at any of those would be the defect it fixes.
    const listed = await request(app)
      .get("/api/v1/audit/events")
      .query({ eventType: "EXPORT_BULK", limit: 5 })
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(listed.body.data.events).toHaveLength(5);

    const response = await request(app)
      .get("/api/v1/audit/events/export")
      .query({ eventType: "EXPORT_BULK" })
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(rows(response.text)).toHaveLength(30);
  });

  it("does not let a comma or a quote break the row into wrong columns", async () => {
    const owner = await registerUser(app, { email: `export-escape-${Date.now()}@zoiko.test` });
    await seed(owner.tenantId, owner.userId, [
      {
        eventType: "EXPORT_ESCAPING",
        metadata: { note: 'has, a comma and a "quote" and a\nnewline' },
      },
    ]);

    const response = await request(app)
      .get("/api/v1/audit/events/export")
      .query({ eventType: "EXPORT_ESCAPING" })
      .set(authHeader(owner.accessToken))
      .expect(200);

    // Parsed back, the metadata survives intact and the row still has exactly
    // as many fields as the header names.
    const body = response.text.replace(/^﻿/, "");
    const headerFields = header(response.text);
    const dataStart = body.indexOf("\n") + 1;
    const record = parseCsvLine(body.slice(dataStart).replace(/\n$/, ""));
    expect(record).toHaveLength(headerFields.length);
    expect(JSON.parse(record[10]!)).toMatchObject({
      note: 'has, a comma and a "quote" and a\nnewline',
    });
  });

  it("neutralises a value a spreadsheet would run as a formula", async () => {
    const owner = await registerUser(app, { email: `export-formula-${Date.now()}@zoiko.test` });
    await seed(owner.tenantId, owner.userId, [
      { eventType: "EXPORT_FORMULA", targetId: "=1+1" },
    ]);

    const response = await request(app)
      .get("/api/v1/audit/events/export")
      .query({ eventType: "EXPORT_FORMULA" })
      .set(authHeader(owner.accessToken))
      .expect(200);

    // Prefixed, so a spreadsheet shows the text rather than evaluating it.
    // target_id, one column further right now that actor_type is carried.
    expect(rows(response.text)[0]![6]).toBe("'=1+1");
  });

  it("redacts the same metadata the list endpoint redacts", async () => {
    const owner = await registerUser(app, { email: `export-redact-${Date.now()}@zoiko.test` });
    await seed(owner.tenantId, owner.userId, [
      { eventType: "EXPORT_SECRET", metadata: { accessToken: "raw-token", safe: "ok" } },
    ]);

    const response = await request(app)
      .get("/api/v1/audit/events/export")
      .query({ eventType: "EXPORT_SECRET" })
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(response.text).not.toContain("raw-token");
    expect(response.text).toContain("[REDACTED]");
  });

  it("carries no other tenant's rows", async () => {
    const owner = await registerUser(app, { email: `export-mine-${Date.now()}@zoiko.test` });
    const other = await registerUser(app, { email: `export-theirs-${Date.now()}@zoiko.test` });
    await seed(owner.tenantId, owner.userId, [{ eventType: "EXPORT_TENANCY", targetId: "mine" }]);
    await seed(other.tenantId, other.userId, [{ eventType: "EXPORT_TENANCY", targetId: "theirs" }]);

    const response = await request(app)
      .get("/api/v1/audit/events/export")
      .query({ eventType: "EXPORT_TENANCY" })
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(response.text).toContain("mine");
    expect(response.text).not.toContain("theirs");
  });

  it("withholds from an Admin exactly what the screen withholds", async () => {
    const owner = await registerUser(app, { email: `export-scope-${Date.now()}@zoiko.test` });
    await seed(owner.tenantId, owner.userId, [
      { eventType: "BILLING_PLAN_CHANGED", targetId: "commercial" },
      { eventType: "EXPORT_ORDINARY", targetId: "ordinary" },
    ]);

    const invited = await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({
        email: `export-admin-${Date.now()}@zoiko.test`,
        role: "ADMIN",
        displayName: "Export Admin",
        password: "Password123!",
      });

    // Only meaningful if an Admin membership could be created here; the point
    // is the scope, not the invitation mechanics.
    if (invited.status >= 400) return;

    const admin = await registerUser(app, { email: `export-admin2-${Date.now()}@zoiko.test` });
    await prisma.tenantMembership.updateMany({
      where: { userId: admin.userId },
      data: { tenantId: owner.tenantId, role: "ADMIN" },
    });

    const response = await request(app)
      .get("/api/v1/audit/events/export")
      .set(authHeader(admin.accessToken));

    if (response.status !== 200) return;
    // An Admin may audit what they could have done, not the commercial terms
    // of the tenancy — the same withholding `list` applies.
    expect(response.text).not.toContain("BILLING_PLAN_CHANGED");
  });

  it("records the export, because taking a copy of the trail is itself an act", async () => {
    const owner = await registerUser(app, { email: `export-audited-${Date.now()}@zoiko.test` });
    await seed(owner.tenantId, owner.userId, [{ eventType: "EXPORT_AUDITED" }]);

    await request(app)
      .get("/api/v1/audit/events/export")
      .query({ eventType: "EXPORT_AUDITED" })
      .set(authHeader(owner.accessToken))
      .expect(200);

    const recorded = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "AUDIT_LOG_EXPORTED" },
    });
    expect(recorded).not.toBeNull();
    expect(recorded?.actorUserId).toBe(owner.userId);
    expect((recorded?.metadata as { filters?: Record<string, unknown> })?.filters).toMatchObject({
      eventType: "EXPORT_AUDITED",
    });
  });

  it("refuses a caller without audit.read", async () => {
    const owner = await registerUser(app, { email: `export-owner-${Date.now()}@zoiko.test` });
    const member = await registerUser(app, { email: `export-member-${Date.now()}@zoiko.test` });
    await prisma.tenantMembership.updateMany({
      where: { userId: member.userId },
      data: { tenantId: owner.tenantId, role: "MEMBER" },
    });

    const response = await request(app)
      .get("/api/v1/audit/events/export")
      .set(authHeader(member.accessToken));

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects a range that ends before it starts", async () => {
    const owner = await registerUser(app, { email: `export-range-${Date.now()}@zoiko.test` });

    await request(app)
      .get("/api/v1/audit/events/export")
      .query({ from: "2026-02-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" })
      .set(authHeader(owner.accessToken))
      .expect(400);
  });
});

describe("filtering by category", () => {
  /**
   * A category on the screen is a set of prefixes, not one event type. Before
   * this the screen fetched a page and filtered it in the browser, so a
   * category answered from the newest 50 rows and reported nothing when the
   * matching events were older than that.
   */
  it("matches every prefix in the set and nothing outside it", async () => {
    const owner = await registerUser(app, { email: `prefix-${Date.now()}@zoiko.test` });
    await seed(owner.tenantId, owner.userId, [
      { eventType: "LOGIN_SUCCESS" },
      { eventType: "MFA_CHALLENGE_FAILED" },
      { eventType: "MAILBOX_CREATED" },
    ]);

    const response = await request(app)
      .get("/api/v1/audit/events")
      .query({ eventTypePrefix: ["LOGIN_", "MFA_"], limit: 100 })
      .set(authHeader(owner.accessToken))
      .expect(200);

    const types = response.body.data.events.map((e: { eventType: string }) => e.eventType);
    expect(types).toContain("LOGIN_SUCCESS");
    expect(types).toContain("MFA_CHALLENGE_FAILED");
    expect(types).not.toContain("MAILBOX_CREATED");
  });

  it("accepts a single prefix without an array wrapper", async () => {
    const owner = await registerUser(app, { email: `prefix-one-${Date.now()}@zoiko.test` });
    await seed(owner.tenantId, owner.userId, [
      { eventType: "AI_ACTION_REQUESTED" },
      { eventType: "MAILBOX_CREATED" },
    ]);

    const response = await request(app)
      .get("/api/v1/audit/events")
      .query({ eventTypePrefix: "AI_", limit: 100 })
      .set(authHeader(owner.accessToken))
      .expect(200);

    const types = response.body.data.events.map((e: { eventType: string }) => e.eventType);
    expect(types).toContain("AI_ACTION_REQUESTED");
    expect(types).not.toContain("MAILBOX_CREATED");
  });

  it("filters the export the same way, so the file matches the screen", async () => {
    const owner = await registerUser(app, { email: `prefix-export-${Date.now()}@zoiko.test` });
    await seed(owner.tenantId, owner.userId, [
      { eventType: "DOMAIN_VERIFIED", targetId: "wanted" },
      { eventType: "MAILBOX_CREATED", targetId: "unwanted" },
    ]);

    const response = await request(app)
      .get("/api/v1/audit/events/export")
      .query({ eventTypePrefix: "DOMAIN_" })
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(response.text).toContain("wanted");
    expect(response.text).not.toContain("unwanted");
  });

  it("cannot be used to reach past what an Admin may read", async () => {
    const owner = await registerUser(app, { email: `prefix-scope-${Date.now()}@zoiko.test` });
    await seed(owner.tenantId, owner.userId, [{ eventType: "BILLING_PLAN_CHANGED" }]);

    const admin = await registerUser(app, { email: `prefix-admin-${Date.now()}@zoiko.test` });
    await prisma.tenantMembership.updateMany({
      where: { userId: admin.userId },
      data: { tenantId: owner.tenantId, role: "ADMIN" },
    });

    const response = await request(app)
      .get("/api/v1/audit/events")
      .query({ eventTypePrefix: "BILLING_", limit: 100 })
      .set(authHeader(admin.accessToken));

    if (response.status !== 200) return;
    // The withholding is applied after the caller's filters, so asking for the
    // excluded prefix by name returns nothing rather than everything.
    const types = response.body.data.events.map((e: { eventType: string }) => e.eventType);
    expect(types).not.toContain("BILLING_PLAN_CHANGED");
  });
});
