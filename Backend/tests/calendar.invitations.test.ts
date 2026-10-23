import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Invitations & RSVP (Calendar step 2).
 *
 * An organizer invites colleagues (members of the workspace, who answer in
 * Zoiko and see the event on their calendar) and guests (addresses outside
 * it). Attendees accept, tentatively accept, decline or propose another time;
 * the organizer sees every answer and the event's history. Nobody else can
 * see the event at all.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

type Person = { email: string; token: string; userId: string; tenantId: string };

async function workspace(): Promise<{ owner: Person; join: () => Promise<Person> }> {
  const reg = await registerUser(app, { email: `inv-owner-${uid()}@zoiko.test` });
  const owner: Person = { email: reg.email, token: reg.accessToken as string, userId: reg.userId, tenantId: reg.tenantId };
  const join = async () => {
    const user = await registerUser(app, { email: `inv-member-${uid()}@zoiko.test` });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.token)).send({ email: user.email, role: "MEMBER" }).expect(201);
    const login = await loginUser(app, user.email, user.password, owner.tenantId, user.mfaSecret);
    return { email: user.email, token: login.accessToken as string, userId: user.userId, tenantId: owner.tenantId };
  };
  return { owner, join };
}

async function calendarOf(person: Person): Promise<string> {
  const res = await request(app).get("/api/v1/calendar/calendars").set(authHeader(person.token)).expect(200);
  return res.body.data[0].id;
}

const tomorrow = (hour: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function invite(organizer: Person, attendees: string[], extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/v1/calendar/events")
    .set(authHeader(organizer.token))
    .send({
      calendarId: await calendarOf(organizer),
      title: "Product strategy review",
      description: "1. Objectives\n2. Risks",
      location: "Horizon Room",
      startsAt: tomorrow(10),
      endsAt: tomorrow(11),
      timeZone: "Europe/London",
      attendees,
      ...extra,
    })
    .expect(201);
  return res.body.data as { id: string; attendees: Array<{ email: string; response: string }> };
}

const get = (p: Person, path: string) => request(app).get(`/api/v1/calendar${path}`).set(authHeader(p.token));
const post = (p: Person, path: string, body: object = {}) => request(app).post(`/api/v1/calendar${path}`).set(authHeader(p.token)).send(body);

describe("inviting people", () => {
  it("invites a colleague, who sees it waiting for an answer, on their calendar and in their bell", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const event = await invite(owner, [colleague.email.toUpperCase(), "guest@outside.example"]);
    expect(event.attendees.map((a) => a.email).sort()).toEqual([colleague.email, "guest@outside.example"].sort());

    const awaiting = (await get(colleague, "/invitations?tab=awaiting").expect(200)).body.data;
    expect(awaiting).toHaveLength(1);
    expect(awaiting[0]).toMatchObject({ eventId: event.id, title: "Product strategy review", myResponse: "NEEDS_ACTION", isNew: true, attendeeCount: 2 });
    expect(awaiting[0].organizer.email).toBe(owner.email);
    expect((await get(colleague, "/invitations/counts").expect(200)).body.data).toEqual({ awaiting: 1, updates: 0 });

    const onCalendar = (await get(colleague, `/events?from=${tomorrow(0)}&to=${tomorrow(23)}`).expect(200)).body.data;
    expect(onCalendar).toHaveLength(1);
    expect(onCalendar[0]).toMatchObject({ id: event.id, source: "INVITED", myResponse: "NEEDS_ACTION" });

    const bell = await prisma.notification.findMany({ where: { userId: colleague.userId, tenantId: owner.tenantId } });
    expect(bell.map((n) => n.title)).toContain("Invitation: Product strategy review");
    expect(bell[0]!.linkPath).toBe(`/mail/calendar/invitations?event=${event.id}`);
  });

  it("does not invite the organizer to their own event, and refuses a bad address", async () => {
    const { owner } = await workspace();
    const event = await invite(owner, [owner.email]);
    expect(event.attendees).toHaveLength(0);
    await request(app)
      .post("/api/v1/calendar/events")
      .set(authHeader(owner.token))
      .send({ calendarId: await calendarOf(owner), title: "x", startsAt: tomorrow(9), endsAt: tomorrow(10), attendees: ["not-an-email"] })
      .expect(400);
  });

  it("treats somebody from another workspace as a guest, who cannot see the event", async () => {
    const { owner } = await workspace();
    const other = await workspace();
    const event = await invite(owner, [other.owner.email]);
    const detail = (await get(owner, `/events/${event.id}/details`).expect(200)).body.data;
    expect(detail.attendees[0]).toMatchObject({ email: other.owner.email, isMember: false });
    await get(other.owner, `/events/${event.id}/details`).expect(404);
    expect((await get(other.owner, "/invitations?tab=all").expect(200)).body.data).toHaveLength(0);
  });

  it("keeps the event from colleagues who were not invited", async () => {
    const { owner, join } = await workspace();
    const invited = await join();
    const bystander = await join();
    const event = await invite(owner, [invited.email]);
    await get(bystander, `/events/${event.id}/details`).expect(404);
    await post(bystander, `/events/${event.id}/respond`, { response: "ACCEPTED" }).expect(404);
    // An attendee answers, but cannot edit or delete the organizer's event.
    await request(app).patch(`/api/v1/calendar/events/${event.id}`).set(authHeader(invited.token)).send({ title: "Mine" }).expect(404);
    await request(app).delete(`/api/v1/calendar/events/${event.id}`).set(authHeader(invited.token)).expect(404);
  });

  it("suggests colleagues to invite, never oneself", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const people = (await get(owner, "/people?q=inv-member").expect(200)).body.data;
    expect(people.map((p: { email: string }) => p.email)).toContain(colleague.email);
    expect(people.map((p: { email: string }) => p.email)).not.toContain(owner.email);
  });
});

describe("answering", () => {
  it("accepts, and the organizer sees the answer, the counts and the history", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const event = await invite(owner, [colleague.email, "guest@outside.example"]);

    const answered = await post(colleague, `/events/${event.id}/respond`, { response: "ACCEPTED", comment: "See you there" }).expect(200);
    expect(answered.body.data).toMatchObject({ myResponse: "ACCEPTED", myComment: "See you there" });
    expect((await get(colleague, "/invitations/counts").expect(200)).body.data.awaiting).toBe(0);
    expect((await get(colleague, "/invitations?tab=accepted").expect(200)).body.data).toHaveLength(1);

    const detail = (await get(owner, `/events/${event.id}/details`).expect(200)).body.data;
    expect(detail.isOrganizer).toBe(true);
    expect(detail.counts).toEqual({ accepted: 1, tentative: 0, declined: 0, needsAction: 1 });
    expect(detail.history.map((h: { type: string }) => h.type)).toEqual(expect.arrayContaining(["INVITED", "RESPONDED"]));
    const bell = await prisma.notification.findMany({ where: { userId: owner.userId } });
    expect(bell.some((n) => n.title.includes("accepted"))).toBe(true);

    const sent = (await get(owner, "/invitations?tab=sent").expect(200)).body.data;
    expect(sent[0].responses).toEqual({ accepted: 1, tentative: 0, declined: 0, needsAction: 1 });
  });

  it("declining takes the event off the attendee's calendar", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const event = await invite(owner, [colleague.email]);
    await post(colleague, `/events/${event.id}/respond`, { response: "DECLINED" }).expect(200);
    const onCalendar = (await get(colleague, `/events?from=${tomorrow(0)}&to=${tomorrow(23)}`).expect(200)).body.data;
    expect(onCalendar).toHaveLength(0);
    // Still answerable: they can change their mind from the invitation.
    await post(colleague, `/events/${event.id}/respond`, { response: "TENTATIVE" }).expect(200);
  });

  it("proposes a new time, which the organizer sees, and counts as tentative", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const event = await invite(owner, [colleague.email]);
    await post(colleague, `/events/${event.id}/propose`, { startsAt: tomorrow(14), endsAt: tomorrow(15), comment: "Clash at 10" }).expect(200);
    const detail = (await get(owner, `/events/${event.id}/details`).expect(200)).body.data;
    expect(detail.attendees[0]).toMatchObject({ response: "TENTATIVE", comment: "Clash at 10", proposedStartsAt: tomorrow(14), proposedEndsAt: tomorrow(15) });
    await post(colleague, `/events/${event.id}/propose`, { startsAt: tomorrow(15), endsAt: tomorrow(14) }).expect(400);
  });

  it("refuses an answer that is not one of the three", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const event = await invite(owner, [colleague.email]);
    await post(colleague, `/events/${event.id}/respond`, { response: "MAYBE" }).expect(400);
  });
});

describe("when the organizer changes or cancels the event", () => {
  it("a new time asks everyone again, and shows as an update until opened", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const event = await invite(owner, [colleague.email]);
    await post(colleague, `/events/${event.id}/respond`, { response: "ACCEPTED" }).expect(200);

    await request(app)
      .patch(`/api/v1/calendar/events/${event.id}`)
      .set(authHeader(owner.token))
      .send({ startsAt: tomorrow(13), endsAt: tomorrow(14) })
      .expect(200);

    expect((await get(colleague, "/invitations/counts").expect(200)).body.data).toEqual({ awaiting: 1, updates: 1 });
    const updates = (await get(colleague, "/invitations?tab=updates").expect(200)).body.data;
    expect(updates[0]).toMatchObject({ eventId: event.id, hasUpdate: true, myResponse: "NEEDS_ACTION" });
    const bell = await prisma.notification.findMany({ where: { userId: colleague.userId } });
    expect(bell.some((n) => n.title === "Updated: Product strategy review")).toBe(true);

    await post(colleague, `/events/${event.id}/seen`).expect(204);
    expect((await get(colleague, "/invitations/counts").expect(200)).body.data.updates).toBe(0);
  });

  it("a description-only edit is not an update and keeps everyone's answer", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const event = await invite(owner, [colleague.email]);
    await post(colleague, `/events/${event.id}/respond`, { response: "ACCEPTED" }).expect(200);
    await request(app).patch(`/api/v1/calendar/events/${event.id}`).set(authHeader(owner.token)).send({ description: "New agenda" }).expect(200);
    const detail = (await get(colleague, `/events/${event.id}/details`).expect(200)).body.data;
    expect(detail).toMatchObject({ myResponse: "ACCEPTED", hasUpdate: false, description: "New agenda" });
  });

  it("removing someone from the list takes the event away from them", async () => {
    const { owner, join } = await workspace();
    const stays = await join();
    const goes = await join();
    const event = await invite(owner, [stays.email, goes.email]);
    const updated = await request(app)
      .patch(`/api/v1/calendar/events/${event.id}`)
      .set(authHeader(owner.token))
      .send({ attendees: [stays.email] })
      .expect(200);
    expect(updated.body.data.attendees.map((a: { email: string }) => a.email)).toEqual([stays.email]);
    await get(goes, `/events/${event.id}/details`).expect(404);
    await get(stays, `/events/${event.id}/details`).expect(200);
  });

  it("deleting the event cancels it for its attendees", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const event = await invite(owner, [colleague.email]);
    await request(app).delete(`/api/v1/calendar/events/${event.id}`).set(authHeader(owner.token)).expect(204);
    await get(colleague, `/events/${event.id}/details`).expect(404);
    expect((await get(colleague, "/invitations/counts").expect(200)).body.data.awaiting).toBe(0);
    const bell = await prisma.notification.findMany({ where: { userId: colleague.userId } });
    expect(bell.some((n) => n.title === "Cancelled: Product strategy review")).toBe(true);
  });
});
