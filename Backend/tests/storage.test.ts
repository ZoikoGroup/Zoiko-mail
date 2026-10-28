import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();
const GIB = 1024 ** 3;

/**
 * Member workspace → Storage. A mailbox starts at 5 GB; the Storage page says
 * where the space went and can recount it exactly.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

async function person() {
  const user = await registerUser(app, { email: `st-${uid()}@zoiko.test`, displayName: "Sam Storage" });
  return { token: user.accessToken as string, tenantId: user.tenantId, membershipId: user.membershipId, email: user.email };
}

const get = (token: string, path: string) => request(app).get(`/api/v1/mail${path}`).set(authHeader(token));

describe("mailbox storage", () => {
  it("gives a new mailbox 5 GB by default", async () => {
    const me = await person();
    const res = await get(me.token, "/mailbox").expect(200);
    expect(res.body.data.storageLimit).toBe(5 * GIB);
    expect(res.body.data.storageUsed).toBe(0);
  });

  it("reports an empty mailbox", async () => {
    const me = await person();
    const res = await get(me.token, "/storage").expect(200);
    expect(res.body.data).toMatchObject({ usedBytes: 0, limitBytes: 5 * GIB, freeBytes: 5 * GIB, full: false, folders: [], largest: [] });
    expect(res.body.data.attachments).toEqual({ files: 0, bytes: 0 });
  });

  it("itemises mail by folder and lists the largest messages first", async () => {
    const me = await person();
    await request(app).post("/api/v1/mail/drafts").set(authHeader(me.token))
      .send({ subject: "Small", textBody: "hi", recipients: { to: ["x@example.com"] } }).expect(201);
    await request(app).post("/api/v1/mail/drafts").set(authHeader(me.token))
      .send({ subject: "Big", textBody: "x".repeat(5000), recipients: { to: ["x@example.com"] } }).expect(201);

    const res = await get(me.token, "/storage").expect(200);
    const drafts = res.body.data.folders.find((f: { folder: string }) => f.folder === "DRAFTS");
    expect(drafts.messages).toBe(2);
    expect(drafts.bytes).toBeGreaterThan(5000);
    expect(res.body.data.largest.map((m: { subject: string }) => m.subject)).toEqual(["Big", "Small"]);
    expect(res.body.data.itemisedBytes).toBe(drafts.bytes);
  });

  it("recalculates stored usage to what the mailbox holds", async () => {
    const me = await person();
    await request(app).post("/api/v1/mail/drafts").set(authHeader(me.token))
      .send({ subject: "Weighty", textBody: "y".repeat(2000), recipients: { to: ["x@example.com"] } }).expect(201);
    // Drift it: usage that no longer matches the mailbox.
    await prisma.mailbox.updateMany({ where: { membershipId: me.membershipId }, data: { storageUsed: 123n * 1024n * 1024n } });

    const before = await get(me.token, "/storage").expect(200);
    expect(before.body.data.usedBytes).toBe(123 * 1024 * 1024);

    const res = await request(app).post("/api/v1/mail/storage/recalculate").set(authHeader(me.token)).expect(200);
    expect(res.body.data.usedBytes).toBe(res.body.data.itemisedBytes);
    expect(res.body.data.usedBytes).toBeGreaterThan(2000);
    expect(res.body.data.usedBytes).toBeLessThan(10_000);
  });

  it("frees space when Trash is emptied", async () => {
    const me = await person();
    const draft = await request(app).post("/api/v1/mail/drafts").set(authHeader(me.token))
      .send({ subject: "Bin me", textBody: "z".repeat(3000), recipients: { to: ["x@example.com"] } }).expect(201);
    await request(app).patch(`/api/v1/mail/${draft.body.data.id}`).set(authHeader(me.token)).send({ folder: "TRASH" });
    await request(app).post("/api/v1/mail/storage/recalculate").set(authHeader(me.token)).expect(200);
    const before = await get(me.token, "/storage").expect(200);
    expect(before.body.data.usedBytes).toBeGreaterThan(3000);

    await request(app).delete("/api/v1/mail/trash").set(authHeader(me.token)).expect(200);
    const after = await get(me.token, "/storage").expect(200);
    expect(after.body.data.usedBytes).toBeLessThan(before.body.data.usedBytes);
  });

  it("reads only the caller's own mailbox", async () => {
    const a = await person();
    const b = await person();
    await request(app).post("/api/v1/mail/drafts").set(authHeader(a.token))
      .send({ subject: "A only", textBody: "private", recipients: { to: ["x@example.com"] } }).expect(201);
    const res = await get(b.token, "/storage").expect(200);
    expect(res.body.data.largest).toEqual([]);
    expect(res.body.data.address).toBe(b.email.toLowerCase());
  });

  it("flags a full mailbox", async () => {
    const me = await person();
    await get(me.token, "/mailbox").expect(200);
    await prisma.mailbox.updateMany({ where: { membershipId: me.membershipId }, data: { storageUsed: BigInt(5 * GIB) } });
    const res = await get(me.token, "/storage").expect(200);
    expect(res.body.data.full).toBe(true);
    expect(res.body.data.freeBytes).toBe(0);
  });
});
