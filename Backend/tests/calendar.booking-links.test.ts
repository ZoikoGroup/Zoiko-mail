import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Scheduling Links (Calendar step 5).
 *
 * A host publishes a booking page; a guest — not signed in — sees only the
 * times the host is free within the link's rules, and books one. The tests
 * are about getting the times right (weekly hours in the link's zone, busy
 * time with buffers, notice), never handing out a slot twice, and the page
 * showing nothing but free times.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

type Person = { email: string; token: string; userId: string; tenantId: string };

async function host(): Promise<Person & { join: () => Promise<Person> }> {
  const reg = await registerUser(app, { email: `bl-host-${uid()}@zoiko.test` });
  const me: Person = { email: reg.email, token: reg.accessToken as string, userId: reg.userId, tenantId: reg.tenantId };
  const join = async (): Promise<Person> => {
    const user = await registerUser(app, { email: `bl-member-${uid()}@zoiko.test` });
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
  del: (path: string) => request(app).delete(`/api/v1/calendar${path}`).set(authHeader(p.token)),
});

/** A weekday at least `min` days ahead, as a UTC date (midnight). */
function weekdayAhead(min = 3): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + min);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
const at = (day: Date, hour: number, minute = 0) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute));

async function link(p: Person, extra: Record<string, unknown> = {}) {
  return (
    await api(p)
      .post("/booking-links", {
        title: "30-minute introduction",
        description: "A first conversation.",
        durationMinutes: 30,
        minNoticeHours: 0,
        timeZone: "UTC",
        weekdays: [1, 2, 3, 4, 5],
        dayStart: "09:00",
        dayEnd: "12:00",
        status: "PUBLISHED",
        ...extra,
      })
      .expect(201)
  ).body.data as { id: string; slug: string; status: string };
}

const publicView = (slug: string, from: Date, to: Date) =>
  request(app).get(`/api/v1/public/booking/${slug}`).query({ from: from.toISOString(), to: to.toISOString() });
const publicBook = (slug: string, startsAt: Date, extra: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/v1/public/booking/${slug}`)
    .send({ name: "Dana Guest", email: "dana@guest.example", startsAt: startsAt.toISOString(), timeZone: "Europe/Paris", ...extra });

const starts = (res: request.Response) => (res.body.data.slots as Array<{ start: string }>).map((s) => s.start);

describe("the booking page", () => {
  it("offers the link's weekly hours, and nothing at weekends", async () => {
    const h = await host();
    const l = await link(h);
    const day = weekdayAhead();
    const res = await publicView(l.slug, at(day, 0), at(day, 23, 59)).expect(200);
    expect(res.body.data).toMatchObject({ title: "30-minute introduction", durationMinutes: 30, timeZone: "UTC", locationType: "VIDEO" });
    expect(res.body.data.host.name).toBeTruthy();
    expect(starts(res)).toEqual(
      ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"].map((t) => at(day, Number(t.slice(0, 2)), Number(t.slice(3))).toISOString())
    );
    const saturday = new Date(day);
    while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() + 1);
    expect(starts(await publicView(l.slug, at(saturday, 0), at(saturday, 23, 59)).expect(200))).toEqual([]);
  });

  it("reads the hours in the link's own time zone", async () => {
    const h = await host();
    const l = await link(h, { timeZone: "America/New_York", dayStart: "09:00", dayEnd: "10:00" });
    const day = weekdayAhead();
    const first = new Date(starts(await publicView(l.slug, at(day, 0), at(day, 23, 59)).expect(200))[0]!);
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(first);
    expect(local).toBe("09:00");
  });

  it("leaves out the host's busy time, with the buffer around it, and never says what it is", async () => {
    const h = await host();
    const l = await link(h, { bufferMinutes: 15 });
    const day = weekdayAhead();
    const calendars = (await api(h).get("/calendars").expect(200)).body.data;
    await api(h).post("/events", { calendarId: calendars[0].id, title: "Secret board meeting", startsAt: at(day, 10).toISOString(), endsAt: at(day, 10, 30).toISOString() }).expect(201);
    const res = await publicView(l.slug, at(day, 0), at(day, 23, 59)).expect(200);
    // 09:30 and 10:30 would sit inside the 15-minute buffer.
    expect(starts(res)).toEqual([at(day, 9), at(day, 11), at(day, 11, 30)].map((d) => d.toISOString()));
    expect(JSON.stringify(res.body)).not.toContain("Secret");
  });

  it("respects the minimum notice", async () => {
    const h = await host();
    const l = await link(h, { minNoticeHours: 24 * 30 });
    const day = weekdayAhead();
    expect(starts(await publicView(l.slug, at(day, 0), at(day, 23, 59)).expect(200))).toEqual([]);
  });

  it("is not there while a draft or paused, or for a slug that does not exist", async () => {
    const h = await host();
    const l = await link(h, { status: "DRAFT" });
    const day = weekdayAhead();
    await publicView(l.slug, at(day, 0), at(day, 23)).expect(404);
    await api(h).patch(`/booking-links/${l.id}`, { status: "PUBLISHED" }).expect(200);
    await publicView(l.slug, at(day, 0), at(day, 23)).expect(200);
    await api(h).patch(`/booking-links/${l.id}`, { status: "PAUSED" }).expect(200);
    await publicView(l.slug, at(day, 0), at(day, 23)).expect(404);
    await publicView("no-such-link-abc123", at(day, 0), at(day, 23)).expect(404);
  });
});

describe("booking", () => {
  it("books a free time: the meeting goes in the host's calendar with the guest invited", async () => {
    const h = await host();
    const l = await link(h);
    const day = weekdayAhead();
    const res = await publicBook(l.slug, at(day, 10), { notes: "About pricing" }).expect(201);
    expect(res.body.data).toMatchObject({ status: "CONFIRMED", startsAt: at(day, 10).toISOString(), endsAt: at(day, 10, 30).toISOString() });

    const booking = await prisma.guestBooking.findUniqueOrThrow({ where: { id: res.body.data.id }, include: { event: { include: { attendees: true, calendar: true } } } });
    expect(booking.event?.title).toBe("30-minute introduction with Dana Guest");
    expect(booking.event?.description).toBe("About pricing");
    expect(booking.event?.calendar.isDefault).toBe(true);
    expect(booking.event?.attendees.map((a) => a.email)).toEqual(["dana@guest.example"]);
    const bell = await prisma.notification.findMany({ where: { userId: h.userId } });
    expect(bell.some((n) => n.title.startsWith("New booking: Dana Guest"))).toBe(true);
    // The slot is gone for the next guest.
    expect(starts(await publicView(l.slug, at(day, 0), at(day, 23, 59)).expect(200))).not.toContain(at(day, 10).toISOString());
  });

  it("refuses a time the link does not offer", async () => {
    const h = await host();
    const l = await link(h);
    const day = weekdayAhead();
    const off = await publicBook(l.slug, at(day, 15)).expect(409);
    expect(off.body.error.details.reason).toBe("SLOT_UNAVAILABLE");
    await publicBook(l.slug, at(day, 10, 10)).expect(409);
    await publicBook(l.slug, at(day, 10), { email: "not-an-email" }).expect(400);
  });

  it("gives a slot to exactly one of two guests asking at once", async () => {
    const h = await host();
    const l = await link(h);
    const day = weekdayAhead();
    const [a, b] = await Promise.all([
      publicBook(l.slug, at(day, 9), { email: "a@guest.example" }),
      publicBook(l.slug, at(day, 9), { email: "b@guest.example" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.guestBooking.count({ where: { linkId: l.id } })).toBe(1);
  });

  it("with approval: holds the slot as a request until the host confirms it", async () => {
    const h = await host();
    const l = await link(h, { requiresApproval: true });
    const day = weekdayAhead();
    const res = await publicBook(l.slug, at(day, 11)).expect(201);
    expect(res.body.data.status).toBe("PENDING");
    expect(starts(await publicView(l.slug, at(day, 0), at(day, 23, 59)).expect(200))).not.toContain(at(day, 11).toISOString());
    expect(await prisma.calendarEvent.count({ where: { tenantId: h.tenantId } })).toBe(0);

    const [pending] = (await api(h).get("/guest-bookings").expect(200)).body.data;
    expect(pending).toMatchObject({ guestName: "Dana Guest", status: "PENDING" });
    await api(h).post(`/guest-bookings/${pending.id}/decision`, { approve: true }).expect(200);
    const confirmed = await prisma.guestBooking.findUniqueOrThrow({ where: { id: pending.id } });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.eventId).toBeTruthy();
    await api(h).post(`/guest-bookings/${pending.id}/decision`, { approve: true }).expect(409);
  });

  it("a declined request frees the slot", async () => {
    const h = await host();
    const l = await link(h, { requiresApproval: true });
    const day = weekdayAhead();
    await publicBook(l.slug, at(day, 9)).expect(201);
    const [pending] = (await api(h).get("/guest-bookings").expect(200)).body.data;
    await api(h).post(`/guest-bookings/${pending.id}/decision`, { approve: false }).expect(200);
    expect(starts(await publicView(l.slug, at(day, 0), at(day, 23, 59)).expect(200))).toContain(at(day, 9).toISOString());
  });

  it("cancelling removes the meeting and frees the slot", async () => {
    const h = await host();
    const l = await link(h);
    const day = weekdayAhead();
    const res = await publicBook(l.slug, at(day, 9, 30)).expect(201);
    const booking = await prisma.guestBooking.findUniqueOrThrow({ where: { id: res.body.data.id } });
    await api(h).post(`/guest-bookings/${booking.id}/cancel`).expect(204);
    expect(await prisma.calendarEvent.findUnique({ where: { id: booking.eventId! } })).toBeNull();
    expect(starts(await publicView(l.slug, at(day, 0), at(day, 23, 59)).expect(200))).toContain(at(day, 9, 30).toISOString());
  });
});

describe("managing links", () => {
  it("lists the host's links with waiting requests, and only the host edits them", async () => {
    const h = await host();
    const colleague = await h.join();
    const l = await link(h, { requiresApproval: true });
    const day = weekdayAhead();
    await publicBook(l.slug, at(day, 9)).expect(201);
    const mine = (await api(h).get("/booking-links").expect(200)).body.data;
    expect(mine[0]).toMatchObject({ id: l.id, isMine: true, kind: "PERSONAL", pendingCount: 1 });
    expect(mine[0].slug).toMatch(/^30-minute-introduction-[a-z0-9]+$/);

    expect((await api(colleague).get("/booking-links").expect(200)).body.data).toHaveLength(0);
    await api(colleague).patch(`/booking-links/${l.id}`, { title: "Mine" }).expect(404);
    await api(colleague).del(`/booking-links/${l.id}`).expect(404);
    expect((await api(colleague).get("/guest-bookings").expect(200)).body.data).toHaveLength(0);
  });

  it("refuses rules that make no sense", async () => {
    const h = await host();
    await api(h).post("/booking-links", { title: "x", timeZone: "UTC", dayStart: "17:00", dayEnd: "09:00" }).expect(400);
    await api(h).post("/booking-links", { title: "x", timeZone: "UTC", weekdays: [] }).expect(400);
    await api(h).post("/booking-links", { title: "x", timeZone: "Mars/Base" }).expect(400);
    await api(h).post("/booking-links", { title: "x", timeZone: "UTC", durationMinutes: 5 }).expect(400);
  });

  it("previews a draft link's times for its owner", async () => {
    const h = await host();
    const l = await link(h, { status: "DRAFT" });
    const day = weekdayAhead();
    const slots = (await api(h).get(`/booking-links/${l.id}/slots?from=${at(day, 0).toISOString()}&to=${at(day, 23).toISOString()}`).expect(200)).body.data;
    expect(slots).toHaveLength(6);
  });
});
