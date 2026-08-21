import { describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma.js";

/**
 * Audit immutability, enforced by the database.
 *
 * These tests exist because the opposite was true and provable: a plain
 * `UPDATE audit_events SET event_type = 'TAMPERED'` used to succeed. An audit
 * log the application can rewrite is not evidence, and every automated action
 * the admin workspace takes depends on the log being trustworthy.
 *
 * The assertions are deliberately written against raw SQL rather than the
 * Prisma client. Application-level guards are bypassed exactly when it
 * matters, so the guard has to hold below the application.
 */

async function seedTenantWithAuditRow() {
  const tenant = await prisma.tenant.create({
    data: { name: `Append Only ${Date.now()}`, planCode: "starter" },
    select: { id: true },
  });
  const event = await prisma.auditEvent.create({
    data: { tenantId: tenant.id, eventType: "mailbox_created" },
    select: { id: true },
  });
  return { tenantId: tenant.id, eventId: event.id };
}

describe("audit_events is append-only", () => {
  it("accepts inserts — the log still has to be writable", async () => {
    const { eventId } = await seedTenantWithAuditRow();
    const row = await prisma.auditEvent.findUnique({ where: { id: eventId } });
    expect(row?.eventType).toBe("mailbox_created");
  });

  it("rejects a raw UPDATE, which used to succeed", async () => {
    const { eventId } = await seedTenantWithAuditRow();

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE audit_events SET event_type = 'TAMPERED' WHERE id = '${eventId}'::uuid`
      )
    ).rejects.toThrow(/append-only/i);

    // The row must be untouched, not merely the statement refused.
    const row = await prisma.auditEvent.findUnique({ where: { id: eventId } });
    expect(row?.eventType).toBe("mailbox_created");
  });

  it("rejects updating the metadata of an existing event", async () => {
    const { eventId } = await seedTenantWithAuditRow();
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE audit_events SET metadata = '{"note":"edited"}'::jsonb WHERE id = '${eventId}'::uuid`
      )
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects a targeted DELETE — the 'remove the incriminating row' case", async () => {
    const { eventId } = await seedTenantWithAuditRow();

    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM audit_events WHERE id = '${eventId}'::uuid`
      )
    ).rejects.toThrow(/append-only/i);

    const row = await prisma.auditEvent.findUnique({ where: { id: eventId } });
    expect(row).not.toBeNull();
  });

  it("rejects a bulk DELETE across a whole tenant without the opt-in", async () => {
    const { tenantId, eventId } = await seedTenantWithAuditRow();

    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM audit_events WHERE tenant_id = '${tenantId}'::uuid`
      )
    ).rejects.toThrow(/append-only/i);

    expect(await prisma.auditEvent.findUnique({ where: { id: eventId } })).not.toBeNull();
  });

  it("rejects TRUNCATE, which bypasses row-level triggers", async () => {
    await expect(
      prisma.$executeRawUnsafe("TRUNCATE audit_events")
    ).rejects.toThrow(/append-only/i);
  });
});

describe("the confirmed tenant-deletion path still works", () => {
  it("permits the cascade when the transaction opts in explicitly", async () => {
    const { tenantId, eventId } = await seedTenantWithAuditRow();

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL zoiko.audit_purge = 'on'");
      await tx.$executeRawUnsafe(
        `DELETE FROM audit_events WHERE tenant_id = '${tenantId}'::uuid`
      );
    });

    expect(await prisma.auditEvent.findUnique({ where: { id: eventId } })).toBeNull();
  });

  it("does not let the opt-in leak to a later transaction on the same connection", async () => {
    // SET LOCAL is transaction-scoped. If it leaked, a pooled connection would
    // carry the exemption into an unrelated request.
    const first = await seedTenantWithAuditRow();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL zoiko.audit_purge = 'on'");
      await tx.$executeRawUnsafe(
        `DELETE FROM audit_events WHERE tenant_id = '${first.tenantId}'::uuid`
      );
    });

    const second = await seedTenantWithAuditRow();
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM audit_events WHERE id = '${second.eventId}'::uuid`
      )
    ).rejects.toThrow(/append-only/i);
  });

  it("deletes a tenant's audit trail only as part of deleting the tenant", async () => {
    const { tenantId, eventId } = await seedTenantWithAuditRow();

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL zoiko.audit_purge = 'on'");
      await tx.tenant.delete({ where: { id: tenantId } });
    });

    expect(await prisma.auditEvent.findUnique({ where: { id: eventId } })).toBeNull();
    expect(await prisma.tenant.findUnique({ where: { id: tenantId } })).toBeNull();
  });
});
