import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Team Calendar and Shared Calendars (Calendar step 3).
 *
 * A calendar is shared with a colleague at one of four levels — free/busy,
 * view, edit, manage — or is a team calendar its members share. Free/busy is
 * workspace-wide but never says what the time is taken by. These tests are
 * mostly about the boundaries: what each level can and cannot see and do.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

type Person = { email: string; token: string; userId: string; tenantId: string };

async function workspace() {
  const reg = await registerUser(app, { email: `shr-owner-${uid()}@zoiko.test` });
  const owner: Person = { email: reg.email, token: reg.accessToken as string, userId: reg.userId, tenantId: reg.tenantId };
  const join = async (): Promise<Person> => {
    const user = await registerUser(app, { email: `shr-member-${uid()}@zoiko.test` });
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

async function mainCalendar(p: Person) {
  return (await api(p).get("/calendars").expect(200)).body.data[0].id as string;
}

async function addEvent(p: Person, calendarId: string, title: string, extra: Record<string, unknown> = {}) {
  return (
    await api(p)
      .post("/events", { calendarId, title, location: "Room 4", startsAt: day(1, 10), endsAt: day(1, 11), ...extra })
      .expect(201)
  ).body.data.id as string;
}

const sharedEvents = (p: Person, scope: "shared" | "team") =>
  api(p).get(`/scoped-events?scope=${scope}&from=${day(0, 0)}&to=${day(3, 0)}`);

describe("sharing a calendar", () => {
  it("view access shows details, but a private event only as Busy, and allows no changes", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const cal = await mainCalendar(owner);
    const open = await addEvent(owner, cal, "Roadmap kickoff");
    await addEvent(owner, cal, "Doctor", { visibility: "PRIVATE", startsAt: day(1, 14), endsAt: day(1, 15) });
    await api(owner).post(`/calendars/${cal}/shares`, { email: colleague.email, access: "VIEW" }).expect(200);

    const accessible = (await api(colleague).get("/accessible").expect(200)).body.data;
    const shared = accessible.find((c: { id: string }) => c.id === cal);
    expect(shared).toMatchObject({ access: "VIEW", kind: "PERSONAL", isVisible: true });
    expect(shared.owner.email).toBe(owner.email);

    const events = (await sharedEvents(colleague, "shared").expect(200)).body.data;
    const titles = events.map((e: { title: string }) => e.title).sort();
    expect(titles).toEqual(["Busy", "Roadmap kickoff"]);
    const busy = events.find((e: { title: string }) => e.title === "Busy");
    expect(busy).toMatchObject({ redacted: true, location: null, description: null, canEdit: false });
    expect(JSON.stringify(events)).not.toContain("Doctor");

    // Viewing is not editing.
    await api(colleague).patch(`/events/${open}`, { title: "Changed" }).expect(404);
    await api(colleague).post("/events", { calendarId: cal, title: "Planted", startsAt: day(1, 16), endsAt: day(1, 17) }).expect(403);
    await api(colleague).post(`/calendars/${cal}/shares`, { email: owner.email, access: "VIEW" }).expect(403);
  });

  it("free/busy access shows only that time is taken", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const cal = await mainCalendar(owner);
    await addEvent(owner, cal, "Salary review");
    await api(owner).post(`/calendars/${cal}/shares`, { email: colleague.email, access: "FREE_BUSY" }).expect(200);
    const events = (await sharedEvents(colleague, "shared").expect(200)).body.data;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: "Busy", redacted: true, location: null });
    await api(colleague).get(`/calendars/${cal}/shares`).expect(403);
  });

  it("edit access can add and change events; manage access can share further", async () => {
    const { owner, join } = await workspace();
    const editor = await join();
    const manager = await join();
    const third = await join();
    const cal = await mainCalendar(owner);
    const id = await addEvent(owner, cal, "Weekly sync");
    await api(owner).post(`/calendars/${cal}/shares`, { email: editor.email, access: "EDIT" }).expect(200);
    await api(owner).post(`/calendars/${cal}/shares`, { email: manager.email, access: "MANAGE" }).expect(200);

    await api(editor).patch(`/events/${id}`, { title: "Weekly sync (moved)" }).expect(200);
    await api(editor).post("/events", { calendarId: cal, title: "Added by editor", startsAt: day(2, 9), endsAt: day(2, 10) }).expect(201);
    await api(editor).post(`/calendars/${cal}/shares`, { email: third.email, access: "VIEW" }).expect(403);

    const shares = (await api(manager).post(`/calendars/${cal}/shares`, { email: third.email, access: "VIEW" }).expect(200)).body.data;
    expect(shares.shares.map((s: { email: string }) => s.email)).toContain(third.email);
    // Only the owner deletes the calendar itself.
    await api(manager).del(`/calendars/${cal}`).expect(403);
  });

  it("removing a share takes the calendar away, and a member can leave on their own", async () => {
    const { owner, join } = await workspace();
    const a = await join();
    const b = await join();
    const cal = await mainCalendar(owner);
    await api(owner).post(`/calendars/${cal}/shares`, { email: a.email, access: "VIEW" }).expect(200);
    const list = (await api(owner).post(`/calendars/${cal}/shares`, { email: b.email, access: "VIEW" }).expect(200)).body.data;
    const shareA = list.shares.find((s: { email: string }) => s.email === a.email).id;
    const shareB = list.shares.find((s: { email: string }) => s.email === b.email).id;

    await api(owner).del(`/calendars/${cal}/shares/${shareA}`).expect(204);
    expect((await api(a).get("/accessible").expect(200)).body.data.some((c: { id: string }) => c.id === cal)).toBe(false);
    await api(a).get(`/calendars/${cal}/shares`).expect(404);

    await api(b).del(`/calendars/${cal}/shares/${shareB}`).expect(204);
    expect((await api(b).get("/accessible").expect(200)).body.data.some((c: { id: string }) => c.id === cal)).toBe(false);
  });

  it("hiding a shared calendar changes only the viewer's own view", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const cal = await mainCalendar(owner);
    await api(owner).post(`/calendars/${cal}/shares`, { email: colleague.email, access: "VIEW" }).expect(200);
    await api(colleague).patch(`/calendars/${cal}`, { isVisible: false }).expect(200);
    const theirs = (await api(colleague).get("/accessible").expect(200)).body.data.find((c: { id: string }) => c.id === cal);
    expect(theirs.isVisible).toBe(false);
    const mine = (await api(owner).get("/calendars").expect(200)).body.data.find((c: { id: string }) => c.id === cal);
    expect(mine.isVisible).toBe(true);
    // Renaming is the owner's (or a manager's) call.
    await api(colleague).patch(`/calendars/${cal}`, { name: "Mine now" }).expect(403);
  });

  it("cannot share with somebody outside the workspace", async () => {
    const { owner } = await workspace();
    const stranger = await workspace();
    const cal = await mainCalendar(owner);
    const refused = await api(owner).post(`/calendars/${cal}/shares`, { email: stranger.owner.email, access: "VIEW" }).expect(404);
    expect(refused.body.error.details.reason).toBe("NOT_A_MEMBER");
    await api(stranger.owner).get(`/calendars/${cal}/shares`).expect(404);
  });
});

describe("team calendars", () => {
  it("its members see it and add events; others do not see it at all", async () => {
    const { owner, join } = await workspace();
    const member = await join();
    const outsider = await join();
    const team = (
      await api(owner).post("/team-calendars", { name: "Product & Engineering", color: "blue", members: [member.email] }).expect(201)
    ).body.data;
    expect(team).toMatchObject({ kind: "TEAM", name: "Product & Engineering" });

    const theirs = (await api(member).get("/accessible").expect(200)).body.data.find((c: { id: string }) => c.id === team.id);
    expect(theirs).toMatchObject({ kind: "TEAM", access: "EDIT" });
    await api(member).post("/events", { calendarId: team.id, title: "Sprint planning", startsAt: day(1, 9), endsAt: day(1, 10) }).expect(201);

    const ownerView = (await sharedEvents(owner, "team").expect(200)).body.data;
    expect(ownerView.map((e: { title: string }) => e.title)).toEqual(["Sprint planning"]);
    expect(ownerView[0]).toMatchObject({ source: "TEAM", canEdit: true, redacted: false });

    expect((await sharedEvents(outsider, "team").expect(200)).body.data).toHaveLength(0);
    await api(outsider).post("/events", { calendarId: team.id, title: "x", startsAt: day(1, 9), endsAt: day(1, 10) }).expect(404);
    // A team calendar is not one of the owner's personal calendars.
    expect((await api(owner).get("/calendars").expect(200)).body.data.some((c: { id: string }) => c.id === team.id)).toBe(false);
  });

  it("refuses members from outside the workspace", async () => {
    const { owner } = await workspace();
    await api(owner).post("/team-calendars", { name: "Mixed", members: ["someone@outside.example"] }).expect(400);
  });
});

describe("asking for access", () => {
  it("asks a colleague for view access; they approve, and the calendar appears", async () => {
    const { owner, join } = await workspace();
    const asker = await join();
    const cal = await mainCalendar(owner);
    await addEvent(owner, cal, "Board prep");

    const asked = await api(asker).post("/access-requests", { ownerEmail: owner.email, access: "VIEW", message: "For planning" }).expect(201);
    expect(asked.body.data).toMatchObject({ calendarId: cal, status: "PENDING" });
    // Asking twice keeps one open request.
    await api(asker).post("/access-requests", { ownerEmail: owner.email, access: "VIEW", message: "Again" }).expect(201);

    const incoming = (await api(owner).get("/access-requests").expect(200)).body.data.incoming;
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({ access: "VIEW", message: "Again" });
    expect(incoming[0].requester.email).toBe(asker.email);
    // The asker cannot approve their own request.
    await api(asker).post(`/access-requests/${incoming[0].id}/decision`, { approve: true }).expect(404);

    await api(owner).post(`/access-requests/${incoming[0].id}/decision`, { approve: true }).expect(200);
    const access = (await api(asker).get("/accessible").expect(200)).body.data.find((c: { id: string }) => c.id === cal);
    expect(access.access).toBe("VIEW");
    expect((await sharedEvents(asker, "shared").expect(200)).body.data[0].title).toBe("Board prep");
    await api(owner).post(`/access-requests/${incoming[0].id}/decision`, { approve: true }).expect(409);
    await api(asker).post("/access-requests", { calendarId: cal, access: "VIEW" }).expect(409);
  });

  it("a declined request grants nothing", async () => {
    const { owner, join } = await workspace();
    const asker = await join();
    await mainCalendar(owner);
    await api(asker).post("/access-requests", { ownerEmail: owner.email, access: "EDIT" }).expect(201);
    const [req] = (await api(owner).get("/access-requests").expect(200)).body.data.incoming;
    await api(owner).post(`/access-requests/${req.id}/decision`, { approve: false }).expect(200);
    expect((await api(asker).get("/access-requests").expect(200)).body.data.outgoing[0].status).toBe("DECLINED");
    expect((await api(asker).get("/accessible").expect(200)).body.data.some((c: { access: string }) => c.access !== "OWNER")).toBe(false);
  });
});

describe("free/busy and finding a time", () => {
  it("shows when a colleague is busy, never what with, including meetings they accepted", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const theirs = await mainCalendar(colleague);
    await addEvent(colleague, theirs, "Secret interview", { startsAt: day(1, 9), endsAt: day(1, 10) });
    await addEvent(colleague, theirs, "Lunch walk", { startsAt: day(1, 12), endsAt: day(1, 13), showAs: "FREE" });
    const mine = await mainCalendar(owner);
    const meeting = await addEvent(owner, mine, "Accepted sync", { startsAt: day(1, 15), endsAt: day(1, 16), attendees: [colleague.email] });
    await api(colleague).post(`/events/${meeting}/respond`, { response: "ACCEPTED" }).expect(200);

    const res = await api(owner).get(`/freebusy?emails=${encodeURIComponent(colleague.email)}&from=${day(1, 0)}&to=${day(2, 0)}`).expect(200);
    const person = res.body.data[0];
    expect(person.email).toBe(colleague.email);
    expect(person.busy).toEqual([
      { start: day(1, 9), end: day(1, 10) },
      { start: day(1, 15), end: day(1, 16) },
    ]);
    expect(JSON.stringify(res.body)).not.toContain("Secret interview");
  });

  it("ignores people outside the workspace", async () => {
    const { owner } = await workspace();
    const stranger = await workspace();
    const res = await api(owner).get(`/freebusy?emails=${encodeURIComponent(stranger.owner.email)}&from=${day(1, 0)}&to=${day(2, 0)}`).expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("suggests times when everyone is free, inside working hours", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    // Find a weekday at least two days ahead.
    let offset = 2;
    while ([0, 6].includes(new Date(day(offset, 12)).getUTCDay())) offset++;
    const theirs = await mainCalendar(colleague);
    await addEvent(colleague, theirs, "Busy morning", { startsAt: day(offset, 9), endsAt: day(offset, 11) });

    const res = await api(owner)
      .post("/find-time", {
        emails: [colleague.email],
        from: day(offset, 0),
        to: day(offset + 1, 0),
        durationMinutes: 60,
        timeZone: "UTC",
        dayStartHour: 9,
        dayEndHour: 17,
        limit: 3,
      })
      .expect(200);
    expect(res.body.data.slots).toEqual([
      { start: day(offset, 11), end: day(offset, 12) },
      { start: day(offset, 11, 30), end: day(offset, 12, 30) },
      { start: day(offset, 12), end: day(offset, 13) },
    ]);
    expect(res.body.data.people.map((p: { email: string }) => p.email)).toContain(colleague.email);
  });
});
