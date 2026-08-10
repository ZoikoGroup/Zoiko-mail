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
});
