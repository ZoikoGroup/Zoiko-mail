import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Meeting Templates (Calendar step 6).
 *
 * Personal templates belong to one person. Team templates belong to a team
 * calendar: its managers (and workspace Owners and Admins) publish them, and
 * anyone else's go through the review queue first. Members of the team see
 * only ready ones; outsiders see none.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

type Person = { email: string; token: string; userId: string; tenantId: string };

async function workspace(): Promise<Person & { join: () => Promise<Person> }> {
  const reg = await registerUser(app, { email: `tpl-owner-${uid()}@zoiko.test` });
  const me: Person = { email: reg.email, token: reg.accessToken as string, userId: reg.userId, tenantId: reg.tenantId };
  const join = async (): Promise<Person> => {
    const user = await registerUser(app, { email: `tpl-member-${uid()}@zoiko.test` });
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

type Template = {
  id: string;
  title: string;
  scope: string;
  status: string;
  isMine: boolean;
  canEdit: boolean;
  canReview: boolean;
  reviewNote: string | null;
  reviewedBy: string | null;
};

async function templates(p: Person): Promise<Template[]> {
  return (await api(p).get("/templates").expect(200)).body.data;
}

/** A team calendar managed by `manager`, with `members` able to add meetings. */
async function team(manager: Person, members: Person[]) {
  return (
    await api(manager)
      .post("/team-calendars", { name: `Team ${uid()}`, members: members.map((m) => m.email) })
      .expect(201)
  ).body.data as { id: string };
}

describe("personal templates", () => {
  it("are created with sensible defaults and seen only by their owner", async () => {
    const ws = await workspace();
    const other = await ws.join();
    const res = await api(ws).post("/templates", { title: "Customer onboarding call", durationMinutes: 45, agenda: "1. Goals\n2. Next steps" }).expect(201);
    expect(res.body.data).toMatchObject({
      title: "Customer onboarding call",
      scope: "PERSONAL",
      status: "READY",
      durationMinutes: 45,
      locationType: "VIDEO",
      externalGuests: "APPROVAL",
      recordingAllowed: false,
      isMine: true,
      canEdit: true,
      canReview: false,
    });
    expect((await templates(ws)).map((t) => t.id)).toContain(res.body.data.id);
    expect(await templates(other)).toEqual([]);
    await api(other).patch(`/templates/${res.body.data.id}`, { title: "Mine now" }).expect(404);
    await api(other).del(`/templates/${res.body.data.id}`).expect(404);
  });

  it("can be edited, kept as a draft, and deleted", async () => {
    const ws = await workspace();
    const t = (await api(ws).post("/templates", { title: "Weekly 1:1", status: "DRAFT" }).expect(201)).body.data as Template;
    expect(t.status).toBe("DRAFT");
    const edited = await api(ws)
      .patch(`/templates/${t.id}`, { durationMinutes: 25, bufferMinutes: 5, minNoticeHours: 4, recordingAllowed: true, status: "READY" })
      .expect(200);
    expect(edited.body.data).toMatchObject({ durationMinutes: 25, bufferMinutes: 5, minNoticeHours: 4, recordingAllowed: true, status: "READY" });
    await api(ws).del(`/templates/${t.id}`).expect(204);
    expect(await templates(ws)).toEqual([]);
  });

  it("rejects bad input", async () => {
    const ws = await workspace();
    await api(ws).post("/templates", { title: "" }).expect(400);
    await api(ws).post("/templates", { title: "Long", durationMinutes: 900 }).expect(400);
    await api(ws).post("/templates", { title: "Guests", defaultAttendees: ["not-an-email"] }).expect(400);
    await api(ws).post("/templates", { title: "Status", status: "PENDING_REVIEW" }).expect(400);
    await api(ws).post("/templates", { title: "Team", scope: "TEAM" }).expect(400);
    await api(ws).post("/templates", { title: "Extra", ownerMembershipId: "x" }).expect(400);
  });

  it("can be duplicated as a personal draft, and the original stays as it was", async () => {
    const ws = await workspace();
    const t = (await api(ws).post("/templates", { title: "Design review", durationMinutes: 60, agenda: "Walkthrough" }).expect(201)).body.data as Template;
    const copy = (await api(ws).post(`/templates/${t.id}/duplicate`).expect(201)).body.data;
    expect(copy).toMatchObject({ title: "Design review (copy)", scope: "PERSONAL", status: "DRAFT", durationMinutes: 60, agenda: "Walkthrough" });
    expect(copy.id).not.toBe(t.id);
    expect((await templates(ws)).find((x) => x.id === t.id)?.title).toBe("Design review");
  });
});

describe("team templates", () => {
  it("are published directly by a team manager and visible to the team, not to others", async () => {
    const ws = await workspace();
    const manager = await ws.join();
    const member = await ws.join();
    const outsider = await ws.join();
    const cal = await team(manager, [member]);
    const t = (await api(manager).post("/templates", { title: "Sprint planning", scope: "TEAM", teamCalendarId: cal.id }).expect(201)).body.data;
    expect(t).toMatchObject({ scope: "TEAM", status: "READY", canReview: true, teamCalendar: { id: cal.id } });
    expect(t.reviewedBy).toBeTruthy();

    const seen = (await templates(member)).find((x) => x.id === t.id);
    expect(seen).toMatchObject({ isMine: false, canEdit: false, canReview: false });
    expect((await templates(outsider)).find((x) => x.id === t.id)).toBeUndefined();
    // A member can use it but not change it.
    await api(member).patch(`/templates/${t.id}`, { title: "Changed" }).expect(403);
    await api(outsider).patch(`/templates/${t.id}`, { title: "Changed" }).expect(404);
    // Anyone who sees it can copy it for themselves.
    await api(member).post(`/templates/${t.id}/duplicate`).expect(201);
    await api(outsider).post(`/templates/${t.id}/duplicate`).expect(404);
  });

  it("from a member wait for review, hidden from the team until approved", async () => {
    const ws = await workspace();
    const manager = await ws.join();
    const member = await ws.join();
    const teammate = await ws.join();
    const cal = await team(manager, [member, teammate]);
    const t = (await api(member).post("/templates", { title: "Release retro", scope: "TEAM", teamCalendarId: cal.id }).expect(201)).body.data;
    expect(t).toMatchObject({ status: "PENDING_REVIEW", isMine: true, canReview: false });
    expect((await templates(teammate)).find((x) => x.id === t.id)).toBeUndefined();

    const queue = (await templates(manager)).filter((x) => x.status === "PENDING_REVIEW");
    expect(queue.map((x) => x.id)).toEqual([t.id]);
    expect(queue[0]!.canReview).toBe(true);

    const notes = await prisma.notification.findMany({ where: { tenantId: ws.tenantId, userId: manager.userId } });
    expect(notes.some((n) => n.title.includes("Release retro") && n.linkPath?.includes("/mail/calendar/templates"))).toBe(true);

    // The submitter cannot approve their own.
    await api(member).post(`/templates/${t.id}/review`, { approve: true }).expect(404);
    const approved = await api(manager).post(`/templates/${t.id}/review`, { approve: true }).expect(200);
    expect(approved.body.data).toMatchObject({ status: "READY" });
    expect((await templates(teammate)).find((x) => x.id === t.id)?.status).toBe("READY");
    await api(manager).post(`/templates/${t.id}/review`, { approve: true }).expect(409);

    const told = await prisma.notification.findMany({ where: { tenantId: ws.tenantId, userId: member.userId } });
    expect(told.some((n) => n.title.startsWith("Template approved"))).toBe(true);
  });

  it("go back to review when a member changes them, and can be sent back with a note", async () => {
    const ws = await workspace();
    const manager = await ws.join();
    const member = await ws.join();
    const cal = await team(manager, [member]);
    const t = (await api(member).post("/templates", { title: "Standup", scope: "TEAM", teamCalendarId: cal.id }).expect(201)).body.data;
    await api(manager).post(`/templates/${t.id}/review`, { approve: true }).expect(200);

    const edited = await api(member).patch(`/templates/${t.id}`, { durationMinutes: 20 }).expect(200);
    expect(edited.body.data.status).toBe("PENDING_REVIEW");

    const sentBack = await api(manager).post(`/templates/${t.id}/review`, { approve: false, note: "Keep it to 15 minutes" }).expect(200);
    expect(sentBack.body.data).toMatchObject({ status: "DRAFT", reviewNote: "Keep it to 15 minutes" });
    expect((await templates(member)).find((x) => x.id === t.id)).toMatchObject({ status: "DRAFT", reviewNote: "Keep it to 15 minutes" });

    const resubmitted = await api(member).patch(`/templates/${t.id}`, { durationMinutes: 15, status: "READY" }).expect(200);
    expect(resubmitted.body.data).toMatchObject({ status: "PENDING_REVIEW", reviewNote: null });

    // A manager's own edit publishes straight away.
    const managed = await api(manager).patch(`/templates/${t.id}`, { title: "Daily standup", status: "READY" }).expect(200);
    expect(managed.body.data).toMatchObject({ status: "READY", title: "Daily standup" });
  });

  it("can be reviewed by a workspace Admin or Owner without being on the team", async () => {
    const ws = await workspace(); // the workspace Owner
    const manager = await ws.join();
    const member = await ws.join();
    const cal = await team(manager, [member]);
    const t = (await api(member).post("/templates", { title: "Quarterly review", scope: "TEAM", teamCalendarId: cal.id }).expect(201)).body.data;
    const queue = (await templates(ws)).filter((x) => x.status === "PENDING_REVIEW");
    expect(queue.map((x) => x.id)).toContain(t.id);
    await api(ws).post(`/templates/${t.id}/review`, { approve: true }).expect(200);
  });

  it("need the caller to be on the team calendar", async () => {
    const ws = await workspace();
    const manager = await ws.join();
    const outsider = await ws.join();
    const cal = await team(manager, []);
    await api(outsider).post("/templates", { title: "Sneaky", scope: "TEAM", teamCalendarId: cal.id }).expect(404);
    // A personal calendar is not a team calendar.
    const mine = (await api(outsider).get("/calendars").expect(200)).body.data[0];
    await api(outsider).post("/templates", { title: "Wrong", scope: "TEAM", teamCalendarId: mine.id }).expect(400);
  });

  it("are isolated between workspaces", async () => {
    const a = await workspace();
    const b = await workspace();
    const t = (await api(a).post("/templates", { title: "Private format" }).expect(201)).body.data;
    expect(await templates(b)).toEqual([]);
    await api(b).patch(`/templates/${t.id}`, { title: "x" }).expect(404);
    await api(b).post(`/templates/${t.id}/duplicate`).expect(404);
    await api(b).post(`/templates/${t.id}/review`, { approve: true }).expect(404);
  });
});
