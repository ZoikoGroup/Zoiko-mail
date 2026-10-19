import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/common/utils/password.js";
import { sseManager } from "../src/common/sse/sse.manager.js";
import { authHeader, registerUser } from "./helpers.js";

/**
 * New mail reaching an open inbox, over the real event stream.
 *
 * The other delivery tests spy on sseManager.sendToUser, which proves an event
 * was asked for but not that a browser would ever receive it. These open the
 * stream over HTTP, exactly as EventSource does, and read what arrives.
 */

const app = createApp();
const PASSWORD = "Password123!";
let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

let server: http.Server;
let base = "";
beforeAll(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function colleague(owner: Awaited<ReturnType<typeof registerUser>>) {
  const login = `${unique("rt-login")}@personal.test`;
  await prisma.appUser.create({
    data: { email: login, displayName: "Person", passwordHash: await hashPassword(PASSWORD), status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const added = await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken)).send({ email: login, role: "MEMBER" }).expect(201);
  const address = `${unique("rt-box")}@realtime.test`;
  await prisma.mailbox.create({ data: { tenantId: owner.tenantId, membershipId: added.body.data.id, address, workspaces: ["MEMBER"] } });
  const session = await request(app).post("/api/v1/auth/login").send({ email: address, password: PASSWORD, workspace: "MEMBER" }).expect(200);
  return { address, token: session.body.data.accessToken as string };
}

/** An open event stream, collecting named events as they arrive. */
function openStream(token: string) {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  let status = 0;
  let buffer = "";
  const req = http.get(`${base}/events/stream?token=${encodeURIComponent(token)}`, (res) => {
    status = res.statusCode ?? 0;
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
    });
  });
  req.on("error", () => undefined);
  return {
    events,
    status: () => status,
    close: () => req.destroy(),
    async waitFor(event: string, timeoutMs = 5000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const found = events.find((e) => e.event === event);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`No ${event} within ${timeoutMs}ms; got ${events.map((e) => e.event).join(", ") || "nothing"} (HTTP ${status})`);
    },
  };
}

async function send(token: string, to: string, subject: string) {
  const draft = await request(app).post("/api/v1/mail/drafts").set(authHeader(token)).send({ subject, textBody: "Body", recipients: { to: [to] } }).expect(201);
  await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`).set(authHeader(token)).expect(200);
  return draft.body.data.id as string;
}

describe("new mail over the live event stream", () => {
  it("reaches the recipient's open stream as soon as it is delivered, and the inbox then lists it", async () => {
    const owner = await registerUser(app, { email: `${unique("rt-owner")}@zoiko.test` });
    const sender = await colleague(owner);
    const recipient = await colleague(owner);

    const stream = openStream(recipient.token);
    try {
      await stream.waitFor("CONNECTED");
      const id = await send(sender.token, recipient.address, "Live one");
      const event = await stream.waitFor("NEW_MAIL");
      expect(event.data).toMatchObject({ type: "NEW_MAIL", payload: { folder: "INBOX", messageId: id } });

      const inbox = await request(app).get("/api/v1/mail?folder=INBOX").set(authHeader(recipient.token)).expect(200);
      expect((inbox.body.data.items as Array<{ messageId: string }>).map((item) => item.messageId)).toContain(id);
      // Exactly one announcement for one delivery.
      expect(stream.events.filter((e) => e.event === "NEW_MAIL")).toHaveLength(1);
    } finally {
      stream.close();
    }
  });

  it("serves the stream unbuffered and untransformed, and refuses it without a valid token", async () => {
    const owner = await registerUser(app, { email: `${unique("rt-hdr-owner")}@zoiko.test` });
    const headers = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
      const req = http.get(`${base}/events/stream?token=${encodeURIComponent(owner.accessToken)}`, (res) => {
        resolve(res.headers);
        req.destroy();
      });
      req.on("error", reject);
    });
    expect(headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(headers["cache-control"]).toBe("no-cache, no-transform");
    expect(headers["content-encoding"]).toBeUndefined();
    await request(app).get("/api/v1/events/stream?token=not-a-token").expect(401);
  });

  it("sends a workspace's mail only to the streams opened for that workspace", () => {
    const writes: Record<string, string[]> = { a: [], b: [] };
    const fake = (name: "a" | "b") => ({ write: (chunk: string) => writes[name].push(chunk) }) as never;
    const userId = "11111111-1111-1111-1111-111111111111";
    const offA = sseManager.addClient(userId, "tenant-a", fake("a"));
    const offB = sseManager.addClient(userId, "tenant-b", fake("b"));
    try {
      sseManager.sendToUser(userId, { type: "NEW_MAIL", tenantId: "tenant-a", userId, payload: { messageId: "m" } });
      expect(writes.a).toHaveLength(1);
      expect(writes.b).toHaveLength(0);
      // An event that names no workspace still reaches every stream the person has.
      sseManager.sendToUser(userId, { type: "NOTIFICATION", userId });
      expect(writes.a).toHaveLength(2);
      expect(writes.b).toHaveLength(1);
    } finally {
      offA();
      offB();
    }
  });
});
