import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Rooms & Resources (Calendar step 4).
 *
 * Owners and Admins manage rooms and equipment and approve bookings that need
 * it; any member books. A booking is always for a meeting and follows its
 * time, and one resource is never booked twice for overlapping times — not
 * even by two people asking at the same moment.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

type Person = { email: string; token: string; userId: string; tenantId: string };

async function workspace() {
  const reg = await registerUser(app, { email: `res-owner-${uid()}@zoiko.test` });
  const owner: Person = { email: reg.email, token: reg.accessToken as string, userId: reg.userId, tenantId: reg.tenantId };
  const join = async (): Promise<Person> => {
    const user = await registerUser(app, { email: `res-member-${uid()}@zoiko.test` });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.token)).send({ email: user.email, role: "MEMBER" }).expect(201);
    const login = await loginUser(app, user.email, user.password, owner.tenantId, user.mfaSecret);
    return { email: user.email, token: login.accessToken as string, userId: user.userId, tenantId: owner.tenantId };
  };
  return { owner, join };
}

const api = (p: Person) => ({
  get: (path: string) => request(app).get(`/api/v1/calendar${path}`).set(authHeader(p.token)),
  post: (path: string, body: object = {}) => request(app).post(`/api/v1/calendar${path}`).set(authHeader(p.token)).send(body),
  patch: (path: string, body: object) => request(app).patch(`/api/v1/calendar${path}`).set(authHeader(p.token)).send(body),
  del: (path: string) => request(app).delete(`/api/v1/calendar${path}`).set(authHeader(p.token)),
});

const day = (offset: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
};

async function room(owner: Person, extra: Record<string, unknown> = {}) {
  return (
    await api(owner)
      .post("/resources", {
        name: `Horizon Room ${uid()}`,
        capacity: 8,
        location: "London HQ",
        floor: "Floor 3",
        features: ["Video conferencing", "Large display"],
        ...extra,
      })
      .expect(201)
  ).body.data as { id: string; name: string };
}

const book = (p: Person, resourceId: string, start: string, end: string, extra: Record<string, unknown> = {}) =>
  api(p).post(`/resources/${resourceId}/book`, { title: "Client demo", startsAt: start, endsAt: end, timeZone: "Europe/London", ...extra });

describe("managing rooms", () => {
  it("lets Owners and Admins add rooms, and not members", async () => {
    const { owner, join } = await workspace();
    const member = await join();
    const r = await room(owner);
    expect((await api(member).get("/resources").expect(200)).body.data.map((x: { id: string }) => x.id)).toContain(r.id);
    const refused = await api(member).post("/resources", { name: "Sneaky room" }).expect(403);
    expect(refused.body.error.details.reason).toBe("RESOURCE_MANAGER");
    await api(member).patch(`/resources/${r.id}`, { capacity: 50 }).expect(403);
  });

  it("a retired resource disappears for members and cannot be booked", async () => {
    const { owner, join } = await workspace();
    const member = await join();
    const r = await room(owner);
    await api(owner).patch(`/resources/${r.id}`, { isActive: false }).expect(200);
    expect((await api(member).get("/resources").expect(200)).body.data).toHaveLength(0);
    await book(member, r.id, day(2, 9), day(2, 10)).expect(409);
  });
});

describe("booking a room", () => {
  it("books it for a new meeting in the member's calendar, shown on the board", async () => {
    const { owner, join } = await workspace();
    const member = await join();
    const r = await room(owner);
    const res = await book(member, r.id, day(2, 13), day(2, 14), { attendeeCount: 6 }).expect(201);
    expect(res.body.data.status).toBe("CONFIRMED");

    const event = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: res.body.data.eventId }, include: { calendar: true } });
    expect(event.location).toBe(`${r.name} · London HQ`);
    expect(event.calendar.isDefault).toBe(true);

    const board = (await api(owner).get(`/resources/board?from=${day(2, 0)}&to=${day(3, 0)}`).expect(200)).body.data;
    expect(board.bookings).toHaveLength(1);
    expect(board.bookings[0]).toMatchObject({ resourceId: r.id, title: "Client demo", status: "CONFIRMED", isMine: false });
    expect((await api(member).get("/bookings/mine").expect(200)).body.data[0]).toMatchObject({ status: "CONFIRMED", isMine: true });
  });

  it("never books one room twice for overlapping times", async () => {
    const { owner, join } = await workspace();
    const a = await join();
    const b = await join();
    const r = await room(owner);
    await book(a, r.id, day(2, 10), day(2, 11)).expect(201);
    const clash = await book(b, r.id, day(2, 10, 30), day(2, 11, 30)).expect(409);
    expect(clash.body.error.details.reason).toBe("RESOURCE_UNAVAILABLE");
    // Back to back is fine.
    await book(b, r.id, day(2, 11), day(2, 12)).expect(201);
  });

  it("gives the slot to exactly one of two people asking at the same moment", async () => {
    const { owner, join } = await workspace();
    const a = await join();
    const b = await join();
    const r = await room(owner);
    const results = await Promise.all([book(a, r.id, day(3, 9), day(3, 10)), book(b, r.id, day(3, 9), day(3, 10))]);
    expect(results.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(await prisma.resourceBooking.count({ where: { resourceId: r.id } })).toBe(1);
  });

  it("refuses more people than the room seats", async () => {
    const { owner, join } = await workspace();
    const member = await join();
    const r = await room(owner, { capacity: 4 });
    const refused = await book(member, r.id, day(2, 9), day(2, 10), { attendeeCount: 6 }).expect(409);
    expect(refused.body.error.details.reason).toBe("OVER_CAPACITY");
  });

  it("shows a private meeting only as Reserved to others", async () => {
    const { owner, join } = await workspace();
    const member = await join();
    const r = await room(owner);
    const res = await book(member, r.id, day(2, 15), day(2, 16), { title: "Disciplinary hearing" }).expect(201);
    await api(member).patch(`/events/${res.body.data.eventId}`, { visibility: "PRIVATE" }).expect(200);
    const board = (await api(owner).get(`/resources/board?from=${day(2, 0)}&to=${day(3, 0)}`).expect(200)).body.data;
    expect(board.bookings[0].title).toBe("Reserved");
    expect(JSON.stringify(board)).not.toContain("Disciplinary");
  });
});

describe("rooms that need approval", () => {
  it("holds the slot as pending until an Admin approves it", async () => {
    const { owner, join } = await workspace();
    const member = await join();
    const other = await join();
    const r = await room(owner, { name: `Atlas Boardroom ${uid()}`, requiresApproval: true });
    const res = await book(member, r.id, day(2, 13), day(2, 14)).expect(201);
    expect(res.body.data.status).toBe("PENDING");
    // Pending already holds it.
    await book(other, r.id, day(2, 13), day(2, 14)).expect(409);
    await api(member).get("/bookings/pending").expect(403);

    const pending = (await api(owner).get("/bookings/pending").expect(200)).body.data;
    expect(pending).toHaveLength(1);
    expect(pending[0].bookedBy.email).toBe(member.email);
    await api(member).post(`/bookings/${pending[0].id}/decision`, { approve: true }).expect(403);
    await api(owner).post(`/bookings/${pending[0].id}/decision`, { approve: true }).expect(200);
    expect((await api(member).get("/bookings/mine").expect(200)).body.data[0].status).toBe("CONFIRMED");
    const bell = await prisma.notification.findMany({ where: { userId: member.userId } });
    expect(bell.some((n) => n.title.includes("confirmed"))).toBe(true);
    await api(owner).post(`/bookings/${pending[0].id}/decision`, { approve: true }).expect(409);
  });

  it("a declined booking frees the slot", async () => {
    const { owner, join } = await workspace();
    const member = await join();
    const other = await join();
    const r = await room(owner, { requiresApproval: true });
    await book(member, r.id, day(2, 9), day(2, 10)).expect(201);
    const [pending] = (await api(owner).get("/bookings/pending").expect(200)).body.data;
    await api(owner).post(`/bookings/${pending.id}/decision`, { approve: false }).expect(200);
    await book(other, r.id, day(2, 9), day(2, 10)).expect(201);
  });
});

describe("giving rooms back and moving meetings", () => {
  it("cancelling frees the room; only the booker or an Admin can cancel", async () => {
    const { owner, join } = await workspace();
    const member = await join();
    const other = await join();
    const r = await room(owner);
    await book(member, r.id, day(2, 9), day(2, 10)).expect(201);
    const [mine] = (await api(member).get("/bookings/mine").expect(200)).body.data;
    await api(other).post(`/bookings/${mine.id}/cancel`).expect(404);
    await api(member).post(`/bookings/${mine.id}/cancel`).expect(204);
    await book(other, r.id, day(2, 9), day(2, 10)).expect(201);
  });

  it("moving the meeting moves the room, and a move into a clash is refused whole", async () => {
    const { owner, join } = await workspace();
    const a = await join();
    const b = await join();
    const r = await room(owner);
    const first = (await book(a, r.id, day(2, 9), day(2, 10)).expect(201)).body.data;
    await book(b, r.id, day(2, 14), day(2, 15)).expect(201);

    await api(a).patch(`/events/${first.eventId}`, { startsAt: day(2, 11), endsAt: day(2, 12) }).expect(200);
    const moved = await prisma.resourceBooking.findUniqueOrThrow({ where: { id: first.bookingId } });
    expect(moved.startsAt.toISOString()).toBe(day(2, 11));

    const clash = await api(a).patch(`/events/${first.eventId}`, { startsAt: day(2, 14), endsAt: day(2, 15) }).expect(409);
    expect(clash.body.error.details.reason).toBe("RESOURCE_UNAVAILABLE");
    const event = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: first.eventId } });
    expect(event.startsAt.toISOString()).toBe(day(2, 11));
  });

  it("deleting the meeting frees the room", async () => {
    const { owner, join } = await workspace();
    const a = await join();
    const b = await join();
    const r = await room(owner);
    const first = (await book(a, r.id, day(2, 9), day(2, 10)).expect(201)).body.data;
    await api(a).del(`/events/${first.eventId}`).expect(204);
    await book(b, r.id, day(2, 9), day(2, 10)).expect(201);
  });

  it("adds a room to an existing meeting", async () => {
    const { owner } = await workspace();
    const r = await room(owner);
    const calendars = (await api(owner).get("/calendars").expect(200)).body.data;
    const event = (await api(owner).post("/events", { calendarId: calendars[0].id, title: "Weekly sync", startsAt: day(4, 9), endsAt: day(4, 10) }).expect(201)).body.data;
    await api(owner).post(`/events/${event.id}/resources`, { resourceId: r.id }).expect(201);
    const updated = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.location).toContain(r.name);
    await api(owner).post(`/events/${event.id}/resources`, { resourceId: r.id }).expect(409);
  });
});

describe("other workspaces", () => {
  it("cannot see or book another workspace's rooms", async () => {
    const mine = await workspace();
    const theirs = await workspace();
    const r = await room(mine.owner);
    expect((await api(theirs.owner).get("/resources").expect(200)).body.data).toHaveLength(0);
    await book(theirs.owner, r.id, day(2, 9), day(2, 10)).expect(404);
  });
});
