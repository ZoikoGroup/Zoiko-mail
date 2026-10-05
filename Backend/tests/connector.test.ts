import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";
import { connectorService } from "../src/modules/connector/connector.service.js";

const app = createApp();

function signature(body: unknown) {
  return `sha256=${createHmac(
    "sha256",
    process.env.PROVIDER_CALLBACK_SECRET!
  ).update(JSON.stringify(body)).digest("hex")}`;
}

describe("Track A connector foundation", () => {
  it("enforces read-only scopes and tenant-safe connected accounts", async () => {
    const first = await registerUser(app, { email: "connector-first@zoiko.test" });
    const second = await registerUser(app, { email: "connector-second@zoiko.test" });

    await request(app).post("/api/v1/connectors").set(authHeader(first.accessToken))
      .send({
        provider: "GMAIL",
        providerAccountId: "gmail-account-1",
        email: "connector@gmail.test",
        scopes: ["https://www.googleapis.com/auth/gmail.modify"],
      }).expect(400);

    const created = await request(app).post("/api/v1/connectors")
      .set(authHeader(first.accessToken))
      .send({
        provider: "GMAIL",
        providerAccountId: "gmail-account-1",
        email: "connector@gmail.test",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      }).expect(201);
    expect(created.body.data).toMatchObject({ provider: "GMAIL", status: "PENDING" });
    expect((await request(app).get("/api/v1/connectors")
      .set(authHeader(second.accessToken)).expect(200)).body.data.accounts).toHaveLength(0);
    await request(app).get(`/api/v1/connectors/${created.body.data.id}/events`)
      .set(authHeader(second.accessToken)).expect(404);
  });

  it("authenticates, sanitizes, resolves tenants and deduplicates callbacks", async () => {
    const owner = await registerUser(app, { email: "callback-owner@zoiko.test" });
    const account = await request(app).post("/api/v1/connectors")
      .set(authHeader(owner.accessToken))
      .send({
        provider: "MICROSOFT_365",
        providerAccountId: "graph-account-1",
        email: "owner@outlook.test",
        scopes: ["Mail.Read", "offline_access"],
      }).expect(201);
    const callback = {
      providerEventId: "graph-event-1",
      providerAccountId: "graph-account-1",
      eventType: "MESSAGE_CHANGED",
      resourceType: "MESSAGE",
      resourceId: "provider-message-9",
      occurredAt: new Date().toISOString(),
      accessToken: "must-never-be-stored",
      tenantId: "00000000-0000-4000-8000-000000000000",
    };

    await request(app).post("/api/v1/connectors/callbacks/MICROSOFT_365")
      .send(callback).expect(401);
    const accepted = await request(app).post("/api/v1/connectors/callbacks/MICROSOFT_365")
      .set("x-provider-signature", signature(callback)).send(callback).expect(202);
    expect(accepted.body.data.duplicate).toBe(false);
    const duplicate = await request(app).post("/api/v1/connectors/callbacks/MICROSOFT_365")
      .set("x-provider-signature", signature(callback)).send(callback).expect(200);
    expect(duplicate.body.data.duplicate).toBe(true);

    const stored = await prisma.providerEvent.findUniqueOrThrow({
      where: { id: accepted.body.data.event.id },
    });
    expect(stored.tenantId).toBe(owner.tenantId);
    expect(stored.connectedAccountId).toBe(account.body.data.id);
    expect(JSON.stringify(stored.sanitizedPayload)).not.toContain("accessToken");
    expect(JSON.stringify(stored.sanitizedPayload)).not.toContain(callback.tenantId);
  });

  it("disconnects an account and rejects later callbacks", async () => {
    const owner = await registerUser(app, { email: "disconnect-owner@zoiko.test" });
    const account = await request(app).post("/api/v1/connectors")
      .set(authHeader(owner.accessToken))
      .send({
        provider: "GMAIL",
        providerAccountId: "gmail-disconnected",
        email: "disconnect@gmail.test",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      }).expect(201);
    await request(app).delete(`/api/v1/connectors/${account.body.data.id}`)
      .set(authHeader(owner.accessToken)).expect(200);
    const callback = {
      providerAccountId: "gmail-disconnected",
      eventType: "MAILBOX_CHANGED",
      occurredAt: new Date().toISOString(),
    };
    await request(app).post("/api/v1/connectors/callbacks/GMAIL")
      .set("x-provider-signature", signature(callback)).send(callback).expect(404);
  });

  it("processes reauthorization events and reports provider health", async () => {
    const owner = await registerUser(app, { email: "reauth-owner@zoiko.test" });
    const account = await request(app).post("/api/v1/connectors")
      .set(authHeader(owner.accessToken))
      .send({
        provider: "MICROSOFT_365",
        providerAccountId: "graph-reauth",
        email: "reauth@outlook.test",
        scopes: ["Mail.Read"],
      }).expect(201);
    const callback = {
      providerEventId: "reauth-event",
      providerAccountId: "graph-reauth",
      eventType: "REAUTH_REQUIRED",
      occurredAt: new Date().toISOString(),
    };
    await request(app).post("/api/v1/connectors/callbacks/MICROSOFT_365")
      .set("x-provider-signature", signature(callback)).send(callback).expect(202);
    expect(await connectorService.processNextEvent()).toMatchObject({
      processed: true, status: "PROCESSED",
    });
    expect(await prisma.connectedAccount.findUniqueOrThrow({
      where: { id: account.body.data.id },
    })).toMatchObject({ status: "REAUTH_REQUIRED", lastErrorCode: "REAUTH_REQUIRED" });
    const health = await request(app).get("/api/v1/connectors/health")
      .set(authHeader(owner.accessToken)).expect(200);
    expect(health.body.data.accounts).toContainEqual({
      provider: "MICROSOFT_365", status: "REAUTH_REQUIRED", count: 1,
    });
  });

  it("rejects on-demand sync for other tenants and disconnected accounts, and fails cleanly without tokens", async () => {
    const owner = await registerUser(app, { email: "sync-owner@zoiko.test" });
    const other = await registerUser(app, { email: "sync-other@zoiko.test" });
    const account = await request(app).post("/api/v1/connectors")
      .set(authHeader(owner.accessToken))
      .send({
        provider: "GMAIL",
        providerAccountId: "gmail-sync-now",
        email: "sync-now@gmail.test",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      }).expect(201);

    await request(app).post(`/api/v1/connectors/${account.body.data.id}/sync`)
      .set(authHeader(other.accessToken)).expect(404);

    await prisma.mailbox.create({
      data: { tenantId: owner.tenantId, membershipId: owner.membershipId, address: "sync-now@zoiko.test" },
    });

    const noToken = await request(app).post(`/api/v1/connectors/${account.body.data.id}/sync`)
      .set(authHeader(owner.accessToken)).expect(401);
    expect(noToken.body.error.code).toBe("UNAUTHORIZED");

    await request(app).delete(`/api/v1/connectors/${account.body.data.id}`)
      .set(authHeader(owner.accessToken)).expect(200);
    await request(app).post(`/api/v1/connectors/${account.body.data.id}/sync`)
      .set(authHeader(owner.accessToken)).expect(409);
  });

  it("retries temporary failures, dead-letters them and supports audited replay", async () => {
    const owner = await registerUser(app, { email: "dead-letter-owner@zoiko.test" });
    await request(app).post("/api/v1/connectors").set(authHeader(owner.accessToken))
      .send({
        provider: "GMAIL",
        providerAccountId: "gmail-temporary-failure",
        email: "failure@gmail.test",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      }).expect(201);
    const callback = {
      providerEventId: "temporary-failure-event",
      providerAccountId: "gmail-temporary-failure",
      eventType: "TEMPORARY_FAILURE",
      occurredAt: new Date().toISOString(),
    };
    const accepted = await request(app).post("/api/v1/connectors/callbacks/GMAIL")
      .set("x-provider-signature", signature(callback)).send(callback).expect(202);
    await prisma.providerEvent.update({
      where: { id: accepted.body.data.event.id },
      data: { maxAttempts: 2 },
    });
    expect(await connectorService.processNextEvent()).toMatchObject({ status: "RETRY" });
    await prisma.providerEvent.update({
      where: { id: accepted.body.data.event.id },
      data: { runAt: new Date(0) },
    });
    expect(await connectorService.processNextEvent()).toMatchObject({ status: "DEAD_LETTER" });

    const deadLetters = await request(app).get("/api/v1/connectors/dead-letter")
      .set(authHeader(owner.accessToken)).expect(200);
    expect(deadLetters.body.data.events).toHaveLength(1);
    await request(app)
      .post(`/api/v1/connectors/dead-letter/${accepted.body.data.event.id}/replay`)
      .set(authHeader(owner.accessToken)).expect(200);
    expect(await prisma.providerEvent.findUniqueOrThrow({
      where: { id: accepted.body.data.event.id },
    })).toMatchObject({ processingStatus: "RETRY", attempts: 0, errorCode: null });
  });

  it("leaves a provider event queued until its runAt actually arrives", async () => {
    const owner = await registerUser(app, { email: "future-event-owner@zoiko.test" });
    await request(app).post("/api/v1/connectors").set(authHeader(owner.accessToken))
      .send({
        provider: "GMAIL",
        providerAccountId: "gmail-future-event",
        email: "future-event@gmail.test",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      }).expect(201);
    const due = {
      providerEventId: "due-before-future",
      providerAccountId: "gmail-future-event",
      eventType: "PROVIDER_RATE_LIMIT",
      occurredAt: new Date().toISOString(),
    };
    const future = {
      providerEventId: "future-run-at-event",
      providerAccountId: "gmail-future-event",
      eventType: "PROVIDER_RATE_LIMIT",
      occurredAt: new Date().toISOString(),
    };

    // The retry backoff writes run_at in UTC, so a local CURRENT_TIMESTAMP
    // comparison would let the next attempt through the moment it is scheduled
    // and collapse the backoff to nothing.
    const queued = await request(app).post("/api/v1/connectors/callbacks/GMAIL")
      .set("x-provider-signature", signature(future)).send(future).expect(202);
    await prisma.providerEvent.update({
      where: { id: queued.body.data.event.id },
      data: { runAt: new Date(Date.now() + 3_600_000) },
    });

    // Sweep whatever is genuinely due, including this event's own sibling, so
    // that a `processed: false` below can only mean the future row was skipped.
    await request(app).post("/api/v1/connectors/callbacks/GMAIL")
      .set("x-provider-signature", signature(due)).send(due).expect(202);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const processed = await connectorService.processNextEvent();
      if (!processed.processed) break;
      if (attempt === 49) throw new Error("provider event queue never drained");
    }

    expect(await connectorService.processNextEvent()).toMatchObject({ processed: false });
    expect(await prisma.providerEvent.findUniqueOrThrow({
      where: { id: queued.body.data.event.id },
    })).toMatchObject({ processingStatus: "RECEIVED", attempts: 0, lockedAt: null });
  });

  it("stamps the provider-event lease in UTC so the five-minute reclaim still works", async () => {
    const owner = await registerUser(app, { email: "lease-owner@zoiko.test" });
    // Sweep the queue first, so the claim below can only reach this test's own
    // event rather than something an earlier case left behind.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const processed = await connectorService.processNextEvent();
      if (!processed.processed) break;
      if (attempt === 49) throw new Error("provider event queue never drained");
    }
    await request(app).post("/api/v1/connectors").set(authHeader(owner.accessToken))
      .send({
        provider: "GMAIL",
        providerAccountId: "gmail-lease-owner",
        email: "lease-owner@gmail.test",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      }).expect(201);
    const callback = {
      providerEventId: "lease-owner-event",
      providerAccountId: "gmail-lease-owner",
      eventType: "PROVIDER_RATE_LIMIT",
      occurredAt: new Date().toISOString(),
    };
    const accepted = await request(app).post("/api/v1/connectors/callbacks/GMAIL")
      .set("x-provider-signature", signature(callback)).send(callback).expect(202);
    const eventId = accepted.body.data.event.id as string;

    // claimEvent is the statement that takes the lease, and both of its success
    // and failure paths clear locked_at again, so it has to be exercised
    // directly to see the value it wrote.
    const claimEvent = (connectorService as unknown as {
      claimEvent(): Promise<{ id: string } | null>;
    }).claimEvent.bind(connectorService);

    expect((await claimEvent())?.id).toBe(eventId);
    const leased = await prisma.providerEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(leased.lockedAt).not.toBeNull();
    // A session-local stamp would read back 5h30m in the future here.
    expect(Math.abs(leased.lockedAt!.getTime() - Date.now())).toBeLessThan(60_000);

    // A fresh lease is not yet reclaimable.
    expect(await claimEvent()).toBeNull();

    // Once it is genuinely older than five minutes the reclaim has to fire. The
    // lease write and this comparison share one convention, so moving only one
    // of them would strand every crashed event forever.
    await prisma.providerEvent.update({
      where: { id: eventId },
      data: { lockedAt: new Date(Date.now() - 6 * 60_000) },
    });
    expect((await claimEvent())?.id).toBe(eventId);
  });
});
