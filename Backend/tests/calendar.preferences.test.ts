import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Calendar Settings (Calendar step 7).
 *
 * Each member's preferences are their own, start from sensible defaults
 * without being stored, and are checked. The ones the server acts on —
 * notification groups and access requests — really change what happens.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

type Person = { email: string; token: string; userId: string; tenantId: string };

async function workspace(): Promise<Person & { join: () => Promise<Person> }> {
  const reg = await registerUser(app, { email: `pref-owner-${uid()}@zoiko.test` });
  const me: Person = { email: reg.email, token: reg.accessToken as string, userId: reg.userId, tenantId: reg.tenantId };
  const join = async (): Promise<Person> => {
    const user = await registerUser(app, { email: `pref-member-${uid()}@zoiko.test` });
    await request(app).post("/api/v1/membership/members").set(authHeader(me.token)).send({ email: user.email, role: "MEMBER" }).expect(201);
    const login = await loginUser(app, user.email, user.password, me.tenantId, user.mfaSecret);
    return { email: user.email, token: login.accessToken as string, userId: user.userId, tenantId: me.tenantId };
  };
  return { ...me, join };
}

const api = (p: Person) => ({
  get: (path: string) => request(app).get(`/api/v1/calendar${path}`).set(authHeader(p.token)),
  post: (path: string, body: object = {}) => request(app).post(`/api/v1/calendar${path}`).set(authHeader(p.token)).send(body),
  patch: (path: string, body: object) => request(app).patch(`/api/v1/calendar${path}`).set(authHeader(p.token)).send(body),
});

async function invite(organizer: Person, guest: Person, title: string) {
  const calendar = (await api(organizer).get("/calendars").expect(200)).body.data[0];
  const start = new Date(Date.now() + 3 * 86_400_000);
  await api(organizer)
    .post("/events", { calendarId: calendar.id, title, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString(), attendees: [guest.email] })
    .expect(201);
}

const bell = (p: Person) => prisma.notification.findMany({ where: { tenantId: p.tenantId, userId: p.userId } });

describe("calendar preferences", () => {
  it("start from the defaults without storing anything", async () => {
    const ws = await workspace();
    const res = await api(ws).get("/preferences").expect(200);
    expect(res.body.data).toMatchObject({
      saved: false,
      defaultView: "week",
      weekStart: 1,
      defaultDurationMinutes: 30,
      timeZone: null,
      timeFormat: "H24",
      showWeekends: false,
      workDays: [1, 2, 3, 4, 5],
      workStart: "09:00",
      workEnd: "17:00",
      notifyInvitations: true,
    });
    expect(await prisma.calendarPreference.count({ where: { tenantId: ws.tenantId } })).toBe(0);
  });

  it("save what changed, keep the rest, and come back the same", async () => {
    const ws = await workspace();
    const saved = await api(ws)
      .patch("/preferences", { defaultView: "month", weekStart: 0, timeZone: "Europe/London", timeFormat: "H12", showWeekends: true, workDays: [5, 1, 1, 3], workStart: "08:30" })
      .expect(200);
    expect(saved.body.data).toMatchObject({ saved: true, defaultView: "month", weekStart: 0, timeZone: "Europe/London", timeFormat: "H12", showWeekends: true, workDays: [1, 3, 5], workStart: "08:30", workEnd: "17:00", dateFormat: "DMY" });
    const again = await api(ws).get("/preferences").expect(200);
    expect(again.body.data).toMatchObject({ defaultView: "month", workDays: [1, 3, 5] });
    // Back to following the device.
    expect((await api(ws).patch("/preferences", { timeZone: null }).expect(200)).body.data.timeZone).toBeNull();
  });

  it("are each member's own", async () => {
    const ws = await workspace();
    const other = await ws.join();
    await api(ws).patch("/preferences", { defaultView: "day" }).expect(200);
    expect((await api(other).get("/preferences").expect(200)).body.data.defaultView).toBe("week");
  });

  it("refuse bad values", async () => {
    const ws = await workspace();
    await api(ws).patch("/preferences", {}).expect(400);
    await api(ws).patch("/preferences", { defaultView: "year" }).expect(400);
    await api(ws).patch("/preferences", { weekStart: 3 }).expect(400);
    await api(ws).patch("/preferences", { timeZone: "Mars/Olympus" }).expect(400);
    await api(ws).patch("/preferences", { workDays: [] }).expect(400);
    await api(ws).patch("/preferences", { workStart: "18:00" }).expect(400);
    await api(ws).patch("/preferences", { workStart: "25:00" }).expect(400);
    await api(ws).patch("/preferences", { membershipId: "x" }).expect(400);
  });
});

describe("notification settings", () => {
  it("stop that kind of calendar notification, and only that kind", async () => {
    const ws = await workspace();
    const guest = await ws.join();
    await api(guest).patch("/preferences", { notifyInvitations: false }).expect(200);
    await invite(ws, guest, "Muted planning");
    expect((await bell(guest)).some((n) => n.title.includes("Muted planning"))).toBe(false);

    // Other kinds still arrive: sharing a calendar with them.
    const calendar = (await api(ws).get("/calendars").expect(200)).body.data[0];
    await api(ws).post(`/calendars/${calendar.id}/shares`, { email: guest.email, access: "VIEW" }).expect(200);
    expect((await bell(guest)).some((n) => n.title.startsWith("Shared with you"))).toBe(true);

    // Turned back on, invitations come again.
    await api(guest).patch("/preferences", { notifyInvitations: true }).expect(200);
    await invite(ws, guest, "Loud planning");
    expect((await bell(guest)).some((n) => n.title.includes("Loud planning"))).toBe(true);
  });

  it("do not hide the invitation itself", async () => {
    const ws = await workspace();
    const guest = await ws.join();
    await api(guest).patch("/preferences", { notifyInvitations: false }).expect(200);
    await invite(ws, guest, "Still listed");
    const awaiting = (await api(guest).get("/invitations?tab=awaiting").expect(200)).body.data;
    expect(JSON.stringify(awaiting)).toContain("Still listed");
  });
});

describe("access requests", () => {
  it("are refused when the owner turned them off, and allowed again when back on", async () => {
    const ws = await workspace();
    const asker = await ws.join();
    await api(ws).get("/calendars").expect(200); // the owner's calendar exists once they open it
    await api(ws).patch("/preferences", { allowAccessRequests: false }).expect(200);
    const refused = await api(asker).post("/access-requests", { ownerEmail: ws.email, access: "VIEW" }).expect(403);
    expect(refused.body.error?.details?.reason ?? refused.body.details?.reason ?? JSON.stringify(refused.body)).toContain("ACCESS_REQUESTS_OFF");
    await api(ws).patch("/preferences", { allowAccessRequests: true }).expect(200);
    await api(asker).post("/access-requests", { ownerEmail: ws.email, access: "VIEW" }).expect(201);
  });
});
