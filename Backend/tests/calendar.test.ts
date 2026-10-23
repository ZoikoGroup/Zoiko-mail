import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { withTenant } from "../src/config/tenantScope.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * My Calendar (Calendar step 1): a member's own calendars and events.
 *
 * Everything here belongs to one member. The tests are as much about who
 * cannot see a calendar — a colleague, another workspace — as about the
 * calendar working, because event titles and locations are personal data.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

async function member() {
  const owner = await registerUser(app, { email: `cal-${uid()}@zoiko.test` });
  return { ...owner, token: owner.accessToken as string };
}

async function colleagueOf(owner: Awaited<ReturnType<typeof member>>) {
  const user = await registerUser(app, { email: `cal-colleague-${uid()}@zoiko.test` });
  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.token))
    .send({ email: user.email, role: "MEMBER" })
    .expect(201);
  const login = await loginUser(app, user.email, user.password, owner.tenantId, user.mfaSecret);
  return { ...user, token: login.accessToken as string };
}

const calendars = (token: string) => request(app).get("/api/v1/calendar/calendars").set(authHeader(token));
const createEvent = (token: string, body: Record<string, unknown>) =>
  request(app).post("/api/v1/calendar/events").set(authHeader(token)).send(body);
const listEvents = (token: string, from: string, to: string) =>
  request(app).get("/api/v1/calendar/events").query({ from, to }).set(authHeader(token));

async function defaultCalendarId(token: string): Promise<string> {
  const res = await calendars(token).expect(200);
  return res.body.data[0].id as string;
}

describe("a member's calendars", () => {
  it("starts with one main calendar, created once even when asked for twice at the same moment", async () => {
    const me = await member();
    const [a, b] = await Promise.all([calendars(me.token), calendars(me.token)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const list = (await calendars(me.token).expect(200)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Work", color: "blue", isDefault: true, isVisible: true, kind: "PERSONAL" });
  });

  it("adds, renames, recolours, hides and deletes a calendar", async () => {
    const me = await member();
    await calendars(me.token).expect(200);
    const created = await request(app)
      .post("/api/v1/calendar/calendars")
      .set(authHeader(me.token))
      .send({ name: "Focus Time", color: "amber" })
      .expect(201);
    const id = created.body.data.id;

    const updated = await request(app)
      .patch(`/api/v1/calendar/calendars/${id}`)
      .set(authHeader(me.token))
      .send({ name: "Deep work", color: "purple", isVisible: false })
      .expect(200);
    expect(updated.body.data).toMatchObject({ name: "Deep work", color: "purple", isVisible: false, isDefault: false });

    await request(app).delete(`/api/v1/calendar/calendars/${id}`).set(authHeader(me.token)).expect(204);
    expect((await calendars(me.token).expect(200)).body.data).toHaveLength(1);
  });

  it("refuses to delete the main calendar, and colours outside the palette", async () => {
    const me = await member();
    const id = await defaultCalendarId(me.token);
    const refused = await request(app).delete(`/api/v1/calendar/calendars/${id}`).set(authHeader(me.token)).expect(409);
    expect(refused.body.error.details.reason).toBe("DEFAULT_CALENDAR");
    await request(app)
      .post("/api/v1/calendar/calendars")
      .set(authHeader(me.token))
      .send({ name: "Neon", color: "#ff00ff" })
      .expect(400);
  });

  it("deleting a calendar removes its events with it", async () => {
    const me = await member();
    await calendars(me.token).expect(200);
    const extra = (
      await request(app).post("/api/v1/calendar/calendars").set(authHeader(me.token)).send({ name: "Side" }).expect(201)
    ).body.data.id;
    const event = await createEvent(me.token, {
      calendarId: extra,
      title: "Gone with it",
      startsAt: "2026-10-22T09:00:00.000Z",
      endsAt: "2026-10-22T10:00:00.000Z",
    }).expect(201);
    await request(app).delete(`/api/v1/calendar/calendars/${extra}`).set(authHeader(me.token)).expect(204);
    await request(app).get(`/api/v1/calendar/events/${event.body.data.id}`).set(authHeader(me.token)).expect(404);
  });
});

describe("events", () => {
  it("creates an event and lists it in any range it overlaps, and not outside", async () => {
    const me = await member();
    const calendarId = await defaultCalendarId(me.token);
    const created = await createEvent(me.token, {
      calendarId,
      title: "Product review",
      location: "Conference room",
      videoLink: "https://meet.example.com/abc",
      startsAt: "2026-10-22T11:00:00.000Z",
      endsAt: "2026-10-22T12:00:00.000Z",
      timeZone: "Europe/London",
    }).expect(201);
    expect(created.body.data).toMatchObject({
      title: "Product review",
      calendarId,
      allDay: false,
      timeZone: "Europe/London",
      visibility: "DEFAULT",
      showAs: "BUSY",
    });

    const week = await listEvents(me.token, "2026-10-19T00:00:00.000Z", "2026-10-24T00:00:00.000Z").expect(200);
    expect(week.body.data.map((e: { title: string }) => e.title)).toEqual(["Product review"]);
    // Overlapping the edge counts; touching it does not.
    expect((await listEvents(me.token, "2026-10-22T11:30:00.000Z", "2026-10-22T13:00:00.000Z")).body.data).toHaveLength(1);
    expect((await listEvents(me.token, "2026-10-22T12:00:00.000Z", "2026-10-22T13:00:00.000Z")).body.data).toHaveLength(0);
  });

  it("edits an event, moves it to another calendar, and deletes it", async () => {
    const me = await member();
    const calendarId = await defaultCalendarId(me.token);
    const other = (
      await request(app).post("/api/v1/calendar/calendars").set(authHeader(me.token)).send({ name: "Personal", color: "green" }).expect(201)
    ).body.data.id;
    const id = (
      await createEvent(me.token, {
        calendarId,
        title: "Standup",
        startsAt: "2026-10-22T09:00:00.000Z",
        endsAt: "2026-10-22T09:15:00.000Z",
      }).expect(201)
    ).body.data.id;

    const moved = await request(app)
      .patch(`/api/v1/calendar/events/${id}`)
      .set(authHeader(me.token))
      .send({ title: "Weekly standup", calendarId: other, endsAt: "2026-10-22T09:30:00.000Z", visibility: "PRIVATE" })
      .expect(200);
    expect(moved.body.data).toMatchObject({ title: "Weekly standup", calendarId: other, visibility: "PRIVATE" });
    expect(new Date(moved.body.data.endsAt).toISOString()).toBe("2026-10-22T09:30:00.000Z");

    await request(app).delete(`/api/v1/calendar/events/${id}`).set(authHeader(me.token)).expect(204);
    await request(app).get(`/api/v1/calendar/events/${id}`).set(authHeader(me.token)).expect(404);
  });

  it("stores an all-day event as whole days, whatever time was sent", async () => {
    const me = await member();
    const calendarId = await defaultCalendarId(me.token);
    const res = await createEvent(me.token, {
      calendarId,
      title: "Offsite",
      allDay: true,
      startsAt: "2026-10-26T10:30:00.000Z",
      endsAt: "2026-10-26T10:30:00.000Z",
    }).expect(201);
    expect(res.body.data.startsAt).toBe("2026-10-26T00:00:00.000Z");
    expect(res.body.data.endsAt).toBe("2026-10-27T00:00:00.000Z");
  });

  it("refuses an event that ends before it starts, an unknown time zone, a bad link, and an over-long range", async () => {
    const me = await member();
    const calendarId = await defaultCalendarId(me.token);
    const backwards = await createEvent(me.token, {
      calendarId,
      title: "Backwards",
      startsAt: "2026-10-22T10:00:00.000Z",
      endsAt: "2026-10-22T09:00:00.000Z",
    }).expect(400);
    expect(backwards.body.error.code).toBe("VALIDATION_ERROR");
    await createEvent(me.token, {
      calendarId,
      title: "Nowhere",
      startsAt: "2026-10-22T09:00:00.000Z",
      endsAt: "2026-10-22T10:00:00.000Z",
      timeZone: "Mars/Olympus_Mons",
    }).expect(400);
    await createEvent(me.token, {
      calendarId,
      title: "Link",
      startsAt: "2026-10-22T09:00:00.000Z",
      endsAt: "2026-10-22T10:00:00.000Z",
      videoLink: "not a link",
    }).expect(400);
    await createEvent(me.token, { calendarId, title: "", startsAt: "2026-10-22T09:00:00Z", endsAt: "2026-10-22T10:00:00Z" }).expect(400);
    await listEvents(me.token, "2026-01-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z").expect(400);
  });
});

describe("who can see a calendar", () => {
  it("treats a colleague's calendar and events as absent", async () => {
    const me = await member();
    const colleague = await colleagueOf(me);
    const calendarId = await defaultCalendarId(me.token);
    const id = (
      await createEvent(me.token, {
        calendarId,
        title: "Private 1:1",
        startsAt: "2026-10-22T14:00:00.000Z",
        endsAt: "2026-10-22T15:00:00.000Z",
      }).expect(201)
    ).body.data.id;

    // The colleague has their own, separate calendar and sees none of mine.
    const theirs = (await calendars(colleague.token).expect(200)).body.data;
    expect(theirs.map((c: { id: string }) => c.id)).not.toContain(calendarId);
    const range = await listEvents(colleague.token, "2026-10-19T00:00:00.000Z", "2026-10-24T00:00:00.000Z").expect(200);
    expect(range.body.data).toHaveLength(0);

    await request(app).get(`/api/v1/calendar/events/${id}`).set(authHeader(colleague.token)).expect(404);
    await request(app).patch(`/api/v1/calendar/events/${id}`).set(authHeader(colleague.token)).send({ title: "Mine now" }).expect(404);
    await request(app).delete(`/api/v1/calendar/events/${id}`).set(authHeader(colleague.token)).expect(404);
    await request(app).delete(`/api/v1/calendar/calendars/${calendarId}`).set(authHeader(colleague.token)).expect(404);
    await createEvent(colleague.token, {
      calendarId,
      title: "Planted",
      startsAt: "2026-10-22T16:00:00.000Z",
      endsAt: "2026-10-22T17:00:00.000Z",
    }).expect(404);
  });

  it("keeps one workspace's events out of another's, even without a tenant filter", async () => {
    const me = await member();
    const stranger = await member();
    const calendarId = await defaultCalendarId(me.token);
    await createEvent(me.token, {
      calendarId,
      title: "Board meeting",
      startsAt: "2026-10-22T09:00:00.000Z",
      endsAt: "2026-10-22T10:00:00.000Z",
    }).expect(201);

    // Row-level security: scoped to the other workspace, an unfiltered read finds nothing of mine.
    const seen = await withTenant(stranger.tenantId, () =>
      prisma.calendarEvent.findMany({ where: { title: "Board meeting", calendarId } })
    );
    expect(seen).toHaveLength(0);
    const seenCalendars = await withTenant(stranger.tenantId, () => prisma.calendar.findMany({ where: { id: calendarId } }));
    expect(seenCalendars).toHaveLength(0);
  });

  it("needs a signed-in member", async () => {
    await request(app).get("/api/v1/calendar/calendars").expect(401);
  });
});
