import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { notificationService } from "../src/modules/notification/notification.service.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Settings → Mailbox Preferences → Daily digest: off until chosen, then one
 * digest job a day from 8:00 in the account's own time zone.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

async function person(timezone = "UTC") {
  const user = await registerUser(app, { email: `dg-${uid()}@zoiko.test`, displayName: "Dana Digest" });
  await prisma.appUser.update({ where: { id: user.userId }, data: { timezone, activeTenantId: user.tenantId } });
  return { token: user.accessToken as string, userId: user.userId as string, tenantId: user.tenantId as string };
}

const patch = (token: string, body: object) => request(app).patch("/api/v1/users/me").set(authHeader(token)).send(body);
const jobsFor = (userId: string) =>
  prisma.backgroundJob.count({ where: { type: "NOTIFICATION_DIGEST", idempotencyKey: { startsWith: `digest:daily:${userId}:` } } });

describe("daily digest", () => {
  it("is off by default and can be turned on and off", async () => {
    const me = await person();
    const before = await request(app).get("/api/v1/users/me").set(authHeader(me.token)).expect(200);
    expect(before.body.data.dailyDigest).toBe(false);

    const on = await patch(me.token, { dailyDigest: true }).expect(200);
    expect(on.body.data.dailyDigest).toBe(true);
    const off = await patch(me.token, { dailyDigest: false }).expect(200);
    expect(off.body.data.dailyDigest).toBe(false);
  });

  it("queues one digest per local day, not before 8:00", async () => {
    const me = await person("UTC");
    await patch(me.token, { dailyDigest: true }).expect(200);

    await notificationService.processDailyDigests(new Date("2026-10-28T06:59:00.000Z"));
    expect(await jobsFor(me.userId)).toBe(0);

    await notificationService.processDailyDigests(new Date("2026-10-28T08:05:00.000Z"));
    expect(await jobsFor(me.userId)).toBe(1);

    // Swept again the same day: still one.
    await notificationService.processDailyDigests(new Date("2026-10-28T15:00:00.000Z"));
    expect(await jobsFor(me.userId)).toBe(1);

    // The next day: a second.
    await notificationService.processDailyDigests(new Date("2026-10-29T09:00:00.000Z"));
    expect(await jobsFor(me.userId)).toBe(2);
  });

  it("follows the account's time zone", async () => {
    const me = await person("Asia/Kolkata"); // UTC+5:30
    await patch(me.token, { dailyDigest: true }).expect(200);

    // 02:00 UTC is 07:30 in Kolkata: too early. 03:00 UTC is 08:30: due.
    await notificationService.processDailyDigests(new Date("2026-10-28T02:00:00.000Z"));
    expect(await jobsFor(me.userId)).toBe(0);
    await notificationService.processDailyDigests(new Date("2026-10-28T03:00:00.000Z"));
    expect(await jobsFor(me.userId)).toBe(1);
  });

  it("queues nothing for someone who has not turned it on", async () => {
    const me = await person();
    await notificationService.processDailyDigests(new Date("2026-10-28T12:00:00.000Z"));
    expect(await jobsFor(me.userId)).toBe(0);
  });
});
